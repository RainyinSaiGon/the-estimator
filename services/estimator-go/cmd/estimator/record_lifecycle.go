package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type frozenRecordBaseline struct {
	ID              string    `json:"id"`
	CreatedAt       time.Time `json:"createdAt"`
	SHA256          string    `json:"sha256"`
	EstimateSHA256  string    `json:"estimateSha256"`
	ScopeSHA256     string    `json:"reviewedScopeSha256"`
	EngineVersion   string    `json:"engineVersion"`
	PolicyVersion   string    `json:"policyVersion"`
	EvaluationSplit string    `json:"evaluationSplit"`
	WorkPackageIDs  []string  `json:"workPackageIds"`
}

type lifecycleReviewDecision struct {
	ID           string    `json:"id"`
	Kind         string    `json:"kind"`
	At           time.Time `json:"at"`
	ActorID      string    `json:"actorId"`
	Decision     string    `json:"decision"`
	Note         string    `json:"note,omitempty"`
	BeforeSHA256 string    `json:"beforeSha256,omitempty"`
	AfterSHA256  string    `json:"afterSha256,omitempty"`
}

type deliveryOutcome struct {
	BaselineID          string                    `json:"baselineId"`
	BaselineSHA256      string                    `json:"baselineSha256"`
	SubmittedBy         string                    `json:"submittedBy"`
	ReviewerID          string                    `json:"reviewerId"`
	CompletedAt         time.Time                 `json:"completedAt"`
	ActualHours         map[string]float64        `json:"actualHours"`
	AdditionalHours     float64                   `json:"additionalScopeHours"`
	Synthetic           bool                      `json:"synthetic"`
	EvidenceSource      string                    `json:"evidenceSource"`
	EvidenceReference   string                    `json:"evidenceReference"`
	ReviewStatus        string                    `json:"reviewStatus"`
	EvaluationSplit     string                    `json:"evaluationSplit"`
	CalibrationEligible bool                      `json:"calibrationEligible"`
	CalibrationReason   string                    `json:"calibrationReason"`
	ReviewDecisions     []lifecycleReviewDecision `json:"reviewDecisions"`
}

type createDeliveryRequest struct {
	BaselineID        string             `json:"baselineId"`
	BaselineSHA256    string             `json:"baselineSha256"`
	ReviewerID        string             `json:"reviewerId"`
	CompletedAt       time.Time          `json:"completedAt"`
	ActualHours       map[string]float64 `json:"actualHours"`
	AdditionalHours   float64            `json:"additionalScopeHours"`
	Synthetic         bool               `json:"synthetic"`
	EvidenceSource    string             `json:"evidenceSource"`
	EvidenceReference string             `json:"evidenceReference"`
}

type reviewDeliveryRequest struct {
	Decision string `json:"decision"`
	Note     string `json:"note"`
}

func initializeRecordLifecycle(raw json.RawMessage, payload recordPayload, recordID string, principal recordPrincipal, now time.Time) ([]byte, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return nil, errors.New("snapshot must be an object")
	}
	var estimate, reviewedScope, suggestedScope map[string]any
	if err := json.Unmarshal(payload.Estimate, &estimate); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(payload.ReviewedScope, &reviewedScope); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(payload.SuggestedScope, &suggestedScope); err != nil {
		return nil, err
	}
	canonicalEstimate, err := json.Marshal(estimate)
	if err != nil {
		return nil, err
	}
	canonicalScope, err := json.Marshal(reviewedScope)
	if err != nil {
		return nil, err
	}
	estimateHash := sha256Hex(canonicalEstimate)
	scopeHash := sha256Hex(canonicalScope)
	canonicalSuggestedScope, err := json.Marshal(suggestedScope)
	if err != nil {
		return nil, err
	}
	suggestedScopeHash := sha256Hex(canonicalSuggestedScope)
	var estimateValue struct {
		Tasks []struct {
			Category string `json:"category"`
		} `json:"tasks"`
		Provenance map[string]any `json:"provenance"`
	}
	if err := json.Unmarshal(payload.Estimate, &estimateValue); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(estimateValue.Tasks))
	for _, task := range estimateValue.Tasks {
		id := strings.TrimSpace(task.Category)
		if id == "" {
			return nil, errors.New("estimate work package is missing an ID")
		}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil, errors.New("estimate has no work packages")
	}
	sort.Strings(ids)
	for index := 1; index < len(ids); index++ {
		if ids[index] == ids[index-1] {
			return nil, errors.New("estimate has duplicate work package IDs")
		}
	}
	engineVersion, _ := estimateValue.Provenance["engineVersion"].(string)
	if engineVersion == "" {
		engineVersion = "unknown"
	}
	policyVersion, _ := estimateValue.Provenance["policyVersion"].(string)
	if policyVersion == "" {
		policyVersion, _ = estimateValue.Provenance["historyPolicy"].(string)
	}
	if policyVersion == "" {
		policyVersion = "uncalibrated/v1"
	}
	baselineID, err := newUUID()
	if err != nil {
		return nil, err
	}
	split := frozenEvaluationSplit(recordID)
	baseline := frozenRecordBaseline{
		ID: baselineID, CreatedAt: now.UTC(), EstimateSHA256: estimateHash, ScopeSHA256: scopeHash,
		SHA256: sha256Hex([]byte(estimateHash + ":" + scopeHash)), EngineVersion: engineVersion,
		PolicyVersion: policyVersion, EvaluationSplit: split, WorkPackageIDs: ids,
	}
	baselineBytes, err := json.Marshal(baseline)
	if err != nil {
		return nil, err
	}
	var sourceHashInput []byte
	if err := json.Unmarshal(fields["source"], &payload.Source); err != nil {
		return nil, err
	}
	sourceHashInput = []byte(payload.Source.ReviewText)
	var analysis struct {
		Parser   string         `json:"parser"`
		AgentRun map[string]any `json:"agentRun"`
	}
	_ = json.Unmarshal(fields["reviewedScope"], &analysis)
	if analysis.Parser == "" {
		analysis.Parser = "unknown"
	}
	mode := analysis.Parser
	if agentMode, ok := analysis.AgentRun["mode"].(string); ok && strings.TrimSpace(agentMode) != "" {
		mode = agentMode
	}
	extractionStatus := "complete"
	if payload.Source.Truncated {
		extractionStatus = "partial"
	}
	originalFileHash := ""
	if !bytes.Equal(bytes.TrimSpace(payload.OriginalFile), []byte("null")) {
		var sourceFile recordSourceFile
		if json.Unmarshal(payload.OriginalFile, &sourceFile) != nil {
			return nil, errors.New("original file is invalid")
		}
		if fileBytes, decodeErr := base64.StdEncoding.DecodeString(sourceFile.ContentBase64); decodeErr == nil {
			originalFileHash = sha256Hex(fileBytes)
		}
	}
	provenance := map[string]any{
		"sourceSha256": sha256Hex(sourceHashInput),
		"source":       map[string]any{"name": payload.Source.Name, "type": payload.Source.Type, "extractedTextSha256": sha256Hex(sourceHashInput), "originalFileSha256": originalFileHash, "extractionStatus": extractionStatus, "textCharacters": payload.Source.Characters, "truncated": payload.Source.Truncated},
		"analysis":     map[string]any{"mode": mode, "parser": analysis.Parser, "status": "succeeded", "recordedAt": now.UTC(), "agentRun": analysis.AgentRun},
		"factKinds": map[string]any{
			"modelSuggestions":       suggestedScope,
			"humanConfirmedScope":    reviewedScope,
			"sourceFacts":            sourceEvidenceFacts(reviewedScope, payload.Source.ReviewText),
			"reviewerConfirmedFacts": reviewerConfirmedFacts(reviewedScope),
			"provisionalInferences":  provisionalScopeFacts(reviewedScope),
		},
	}
	provenanceBytes, err := json.Marshal(provenance)
	if err != nil {
		return nil, err
	}
	decisionID, err := newUUID()
	if err != nil {
		return nil, err
	}
	decisions, err := json.Marshal([]lifecycleReviewDecision{{ID: decisionID, Kind: "scope-approved", At: now.UTC(), ActorID: principal.subject, Decision: "approved", BeforeSHA256: suggestedScopeHash, AfterSHA256: scopeHash}})
	if err != nil {
		return nil, err
	}
	fields["schemaVersion"], _ = json.Marshal(2)
	fields["baseline"] = baselineBytes
	fields["provenance"] = provenanceBytes
	fields["reviewDecisions"] = decisions
	fields["deliveryOutcome"] = json.RawMessage("null")
	return json.Marshal(fields)
}

func sourceEvidenceFacts(scope map[string]any, sourceText string) []map[string]string {
	items, _ := scope["requirements"].([]any)
	facts := make([]map[string]string, 0, len(items))
	for _, item := range items {
		row, _ := item.(map[string]any)
		id, _ := row["id"].(string)
		evidence, _ := row["evidence"].(string)
		if id != "" && hasRecordSourceEvidence(sourceText, evidence) {
			facts = append(facts, map[string]string{"requirementId": id, "evidence": evidence})
		}
	}
	return facts
}

func reviewerConfirmedFacts(scope map[string]any) []map[string]string {
	items, _ := scope["requirements"].([]any)
	facts := make([]map[string]string, 0, len(items))
	for _, item := range items {
		row, _ := item.(map[string]any)
		id, _ := row["id"].(string)
		title, _ := row["title"].(string)
		if id != "" {
			facts = append(facts, map[string]string{"requirementId": id, "title": title})
		}
	}
	return facts
}

func hasRecordSourceEvidence(source, quote string) bool {
	normalize := func(value string) string {
		value = strings.ToLower(strings.TrimSpace(value))
		value = strings.NewReplacer("“", `"`, "”", `"`, "‘", "'", "’", "'", "–", "-", "—", "-").Replace(value)
		return strings.Join(strings.Fields(value), " ")
	}
	quote = normalize(quote)
	return quote != "" && strings.Contains(normalize(source), quote)
}

func provisionalScopeFacts(scope map[string]any) map[string]any {
	return map[string]any{"risks": scope["risks"], "missingInformation": scope["missingInformation"], "capabilityFindings": scope["capabilityFindings"]}
}

func sha256Hex(value []byte) string { sum := sha256.Sum256(value); return hex.EncodeToString(sum[:]) }

func frozenEvaluationSplit(recordID string) string {
	sum := sha256.Sum256([]byte("the-estimator-delivery-holdout-v1:" + recordID))
	if sum[0]%5 == 0 {
		return "holdout"
	}
	return "training"
}

func validDeliveryOutcome(raw, baselineRaw json.RawMessage) bool {
	var outcome deliveryOutcome
	var baseline frozenRecordBaseline
	if json.Unmarshal(raw, &outcome) != nil || json.Unmarshal(baselineRaw, &baseline) != nil || !isUUID(outcome.BaselineID) || outcome.BaselineID != baseline.ID || outcome.BaselineSHA256 != baseline.SHA256 || !isUUID(outcome.SubmittedBy) || !isUUID(outcome.ReviewerID) || outcome.SubmittedBy == outcome.ReviewerID || outcome.CompletedAt.IsZero() || outcome.AdditionalHours < 0 || outcome.AdditionalHours > 1_000_000 || len(outcome.ActualHours) != len(baseline.WorkPackageIDs) || (outcome.ReviewStatus != "pending" && outcome.ReviewStatus != "approved" && outcome.ReviewStatus != "rejected") || outcome.EvaluationSplit != baseline.EvaluationSplit {
		return false
	}
	for _, id := range baseline.WorkPackageIDs {
		hours, ok := outcome.ActualHours[id]
		if !ok || hours < 0 || hours > 1_000_000 {
			return false
		}
	}
	for id := range outcome.ActualHours {
		found := false
		for _, expected := range baseline.WorkPackageIDs {
			if id == expected {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	if outcome.ReviewStatus == "pending" && len(outcome.ReviewDecisions) != 0 {
		return false
	}
	if outcome.ReviewStatus == "pending" && outcome.CalibrationEligible {
		return false
	}
	if outcome.ReviewStatus != "pending" {
		if len(outcome.ReviewDecisions) == 0 || !isUUID(outcome.ReviewDecisions[len(outcome.ReviewDecisions)-1].ID) || !isUUID(outcome.ReviewDecisions[len(outcome.ReviewDecisions)-1].ActorID) || outcome.ReviewDecisions[len(outcome.ReviewDecisions)-1].Decision != outcome.ReviewStatus || strings.TrimSpace(outcome.ReviewDecisions[len(outcome.ReviewDecisions)-1].Note) == "" {
			return false
		}
		eligible, _ := deliveryEligibility(outcome)
		if outcome.CalibrationEligible != eligible {
			return false
		}
	}
	return true
}

func (store *recordStore) handleDelivery(w http.ResponseWriter, r *http.Request) {
	store.mutateDelivery(w, r, false)
}

func (store *recordStore) handleDeliveryReview(w http.ResponseWriter, r *http.Request) {
	store.mutateDelivery(w, r, true)
}

func (store *recordStore) handleDeliveryReviewView(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Private records are not configured."})
		return
	}
	principal, ok := store.authorize(w, r)
	if !ok {
		return
	}
	recordID := r.PathValue("recordID")
	if !isUUID(recordID) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Delivery review not found."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	var accountID string
	var nonce, ciphertext []byte
	err := store.pool.QueryRow(ctx, `SELECT r.account_id::text, r.content_nonce, r.content_ciphertext FROM estimator_records r WHERE r.id = $1 AND r.expires_at > now()`, recordID).Scan(&accountID, &nonce, &ciphertext)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Delivery review not found."})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Delivery review could not be loaded."})
		return
	}
	plain, err := store.decryptField(accountID, recordID, "payload", nonce, ciphertext)
	var payload recordPayload
	var outcome deliveryOutcome
	var baseline frozenRecordBaseline
	if err != nil || json.Unmarshal(plain, &payload) != nil || !validRecordPayload(payload) || json.Unmarshal(payload.DeliveryOutcome, &outcome) != nil || json.Unmarshal(payload.Baseline, &baseline) != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Delivery review not found."})
		return
	}
	if outcome.ReviewerID != principal.subject || principal.subject == outcome.SubmittedBy || outcome.ReviewStatus != "pending" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Delivery review not found."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"recordId": recordID, "source": payload.Source, "reviewedScope": json.RawMessage(payload.ReviewedScope), "estimate": json.RawMessage(payload.Estimate), "baseline": baseline, "deliveryOutcome": outcome})
}

func (store *recordStore) mutateDelivery(w http.ResponseWriter, r *http.Request, reviewing bool) {
	w.Header().Set("Cache-Control", "no-store")
	if store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Private records are not configured."})
		return
	}
	principal, ok := store.authorize(w, r)
	if !ok {
		return
	}
	recordID := r.PathValue("recordID")
	if !isUUID(recordID) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Private estimate not found."})
		return
	}
	maximumBody := int64(64 * 1024)
	r.Body = http.MaxBytesReader(w, r.Body, maximumBody)
	defer r.Body.Close()
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "The delivery request is too large."})
		} else {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Provide a valid delivery request."})
		}
		return
	}
	decoder := json.NewDecoder(bytes.NewReader(bodyBytes))
	decoder.DisallowUnknownFields()
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Delivery outcome could not be recorded."})
		return
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	var accountID string
	var nonce, ciphertext []byte
	isOwner := false
	if reviewing {
		err = tx.QueryRow(ctx, `SELECT r.account_id::text, r.content_nonce, r.content_ciphertext, a.owner_key = $2 FROM estimator_records r JOIN estimator_accounts a ON a.id = r.account_id WHERE r.id = $1 AND r.expires_at > now() FOR UPDATE OF r`, recordID, store.ownerLookupKey(principal)).Scan(&accountID, &nonce, &ciphertext, &isOwner)
	} else {
		err = tx.QueryRow(ctx, `SELECT r.account_id::text, r.content_nonce, r.content_ciphertext FROM estimator_records r JOIN estimator_accounts a ON a.id = r.account_id WHERE r.id = $1 AND a.owner_key = $2 AND r.expires_at > now() FOR UPDATE OF r`, recordID, store.ownerLookupKey(principal)).Scan(&accountID, &nonce, &ciphertext)
		isOwner = err == nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Private estimate not found."})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Delivery outcome could not be recorded."})
		return
	}
	plain, err := store.decryptField(accountID, recordID, "payload", nonce, ciphertext)
	var payload recordPayload
	if err != nil || json.Unmarshal(plain, &payload) != nil || !validRecordPayload(payload) || payload.SchemaVersion != 2 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "This estimate has no supported frozen delivery baseline."})
		return
	}
	var baseline frozenRecordBaseline
	if json.Unmarshal(payload.Baseline, &baseline) != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "The frozen baseline is invalid."})
		return
	}
	if !reviewing {
		if !bytes.Equal(bytes.TrimSpace(payload.DeliveryOutcome), []byte("null")) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "A delivery outcome is already recorded for this estimate."})
			return
		}
		var input createDeliveryRequest
		if decoder.Decode(&input) != nil || decoder.Decode(&struct{}{}) != io.EOF {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Provide a valid delivery outcome."})
			return
		}
		if !validDeliveryInput(input, baseline) || !isUUID(input.ReviewerID) || input.ReviewerID == principal.subject {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Provide complete task actuals and designate a different first-party account to review them."})
			return
		}
		outcome := deliveryOutcome{BaselineID: baseline.ID, BaselineSHA256: baseline.SHA256, SubmittedBy: principal.subject, ReviewerID: input.ReviewerID, CompletedAt: input.CompletedAt.UTC(), ActualHours: input.ActualHours, AdditionalHours: input.AdditionalHours, Synthetic: input.Synthetic, EvidenceSource: input.EvidenceSource, EvidenceReference: strings.TrimSpace(input.EvidenceReference), ReviewStatus: "pending", EvaluationSplit: baseline.EvaluationSplit, CalibrationEligible: false, CalibrationReason: "Awaiting review by the designated independent reviewer.", ReviewDecisions: []lifecycleReviewDecision{}}
		payload.DeliveryOutcome, _ = json.Marshal(outcome)
	} else {
		if bytes.Equal(bytes.TrimSpace(payload.DeliveryOutcome), []byte("null")) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "Record a delivery outcome before reviewing it."})
			return
		}
		var input reviewDeliveryRequest
		if decoder.Decode(&input) != nil || decoder.Decode(&struct{}{}) != io.EOF || (input.Decision != "approved" && input.Decision != "rejected") || len(strings.TrimSpace(input.Note)) < 3 || len([]rune(input.Note)) > 1000 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Provide an approval or rejection decision with a short review note."})
			return
		}
		var outcome deliveryOutcome
		if json.Unmarshal(payload.DeliveryOutcome, &outcome) != nil || outcome.ReviewStatus != "pending" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "This delivery outcome has already been reviewed."})
			return
		}
		if outcome.ReviewerID != principal.subject || principal.subject == outcome.SubmittedBy || isOwner {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Delivery review not found."})
			return
		}
		decisionID, idErr := newUUID()
		if idErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Delivery review could not be recorded."})
			return
		}
		outcome.ReviewStatus = input.Decision
		outcome.ReviewDecisions = append(outcome.ReviewDecisions, lifecycleReviewDecision{ID: decisionID, Kind: "delivery-review", At: time.Now().UTC(), ActorID: principal.subject, Decision: input.Decision, Note: strings.TrimSpace(input.Note)})
		outcome.CalibrationEligible, outcome.CalibrationReason = deliveryEligibility(outcome)
		payload.DeliveryOutcome, _ = json.Marshal(outcome)
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Delivery outcome could not be recorded."})
		return
	}
	newNonce, newCiphertext, err := store.encryptField(accountID, recordID, "payload", payloadBytes)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Delivery outcome could not be recorded."})
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE estimator_records SET content_nonce = $1, content_ciphertext = $2 WHERE id = $3 AND account_id = $4`, newNonce, newCiphertext, recordID, accountID); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Delivery outcome could not be recorded."})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Delivery outcome could not be recorded."})
		return
	}
	var outcome deliveryOutcome
	_ = json.Unmarshal(payload.DeliveryOutcome, &outcome)
	responseStatus := http.StatusOK
	if !reviewing {
		responseStatus = http.StatusCreated
	}
	writeJSON(w, responseStatus, map[string]any{"deliveryOutcome": outcome})
}

func validDeliveryInput(input createDeliveryRequest, baseline frozenRecordBaseline) bool {
	if input.BaselineID != baseline.ID || input.BaselineSHA256 != baseline.SHA256 || input.CompletedAt.IsZero() || input.CompletedAt.Before(baseline.CreatedAt) || input.CompletedAt.After(time.Now().Add(24*time.Hour)) || input.AdditionalHours < 0 || input.AdditionalHours > 1_000_000 || (input.EvidenceSource != "timesheet" && input.EvidenceSource != "client-confirmed" && input.EvidenceSource != "manual-reviewed" && input.EvidenceSource != "unknown") {
		return false
	}
	if !input.Synthetic && input.EvidenceSource != "unknown" && len(strings.TrimSpace(input.EvidenceReference)) < 3 {
		return false
	}
	if len(input.ActualHours) != len(baseline.WorkPackageIDs) {
		return false
	}
	for _, id := range baseline.WorkPackageIDs {
		value, ok := input.ActualHours[id]
		if !ok || value < 0 || value > 1_000_000 {
			return false
		}
	}
	for id := range input.ActualHours {
		found := false
		for _, expected := range baseline.WorkPackageIDs {
			if id == expected {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func deliveryEligibility(outcome deliveryOutcome) (bool, string) {
	if outcome.Synthetic {
		return false, "Synthetic outcomes are kept in a separate cohort."
	}
	if (outcome.EvidenceSource != "timesheet" && outcome.EvidenceSource != "client-confirmed" && outcome.EvidenceSource != "manual-reviewed") || strings.TrimSpace(outcome.EvidenceReference) == "" {
		return false, "Evidence source is missing or unverified."
	}
	if outcome.ReviewStatus != "approved" {
		return false, "Outcome has not been approved by a human reviewer."
	}
	if !isUUID(outcome.SubmittedBy) || !isUUID(outcome.ReviewerID) || outcome.ReviewerID == outcome.SubmittedBy {
		return false, "Delivery actuals do not have an independently designated reviewer."
	}
	if len(outcome.ReviewDecisions) == 0 || outcome.ReviewDecisions[len(outcome.ReviewDecisions)-1].Decision != "approved" || outcome.ReviewDecisions[len(outcome.ReviewDecisions)-1].ActorID != outcome.ReviewerID || outcome.ReviewDecisions[len(outcome.ReviewDecisions)-1].ActorID == outcome.SubmittedBy {
		return false, "Delivery approval was not recorded by the designated independent reviewer."
	}
	return true, "Approved by the designated independent reviewer with complete task-level actuals."
}
