package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const companyOwner = "10000000-0000-4000-8000-000000000001"
const companyReviewer = "10000000-0000-4000-8000-000000000002"
const companyOther = "10000000-0000-4000-8000-000000000003"

func workflowFixture() WorkflowCompany {
	c := WorkflowCompany{ID: companyOwner, Name: "Synthetic test company", Config: companyDefaults(), Members: []CompanyMember{{companyOwner, "admin"}, {companyReviewer, "reviewer"}}}
	c.Config.Fields = []IntakeField{{Key: "outcome", Label: "Outcome", Type: "string", Required: true}}
	c.Config.Tasks = []CompanyTask{{ID: "mapping", Label: "Mapping", BaseHours: 10, LowFactor: .7, HighFactor: 1.5}}
	return c
}
func workflowReview() CompanyReview {
	return CompanyReview{RequestType: "integration", Fields: map[string]any{"outcome": "Import contacts"}, Deliverables: "Map and import contacts", Acceptance: "Customer verifies imported records", WorkPackages: []CompanyWorkPackage{{ID: "map", TaskID: "mapping", Title: "Map contacts", Quantity: 1, Owner: "company", Acceptance: "Mapping verified"}}, Confirmed: true}
}
func applyTestAction(t *testing.T, c *WorkflowCompany, actor, role string, a companyAction) error {
	t.Helper()
	_, err := (&recordStore{}).applyCompanyAction(context.Background(), nil, c, role, recordPrincipal{"first-party-v1", actor}, a)
	return err
}
func TestCompanyApprovalAndFreeze(t *testing.T) {
	c := workflowFixture()
	c.Requests = []CompanyRequest{{ID: companyOther, Revision: 1, Text: "Please import our existing contact records into the portal.", UpdatedAt: time.Now()}}
	if err := applyTestAction(t, &c, companyOwner, "member", companyAction{Action: "config", Config: c.Config}); err == nil {
		t.Fatal("member changed configuration")
	}
	if err := applyTestAction(t, &c, companyOwner, "admin", companyAction{Action: "estimate", RequestID: companyOther}); err == nil {
		t.Fatal("unreviewed estimate accepted")
	}
	for _, a := range []companyAction{{Action: "review", RequestID: companyOther, Review: workflowReview()}, {Action: "estimate", RequestID: companyOther}, {Action: "freeze", RequestID: companyOther}} {
		if err := applyTestAction(t, &c, companyOwner, "admin", a); err != nil {
			t.Fatal(err)
		}
	}
	frozen := c.Requests[0].Baselines[0]
	original, _ := json.Marshal(frozen)
	if frozen.SourceSHA256 == "" || frozen.Config.Version != 1 || frozen.FrozenBy != companyOwner {
		t.Fatal("frozen provenance missing")
	}
	a := companyAction{Action: "delivery", RequestID: companyOther, BaselineID: frozen.ID, ReviewerID: companyOwner, CompletedAt: time.Now().Add(time.Second), ActualHours: map[string]float64{"map": 12}, EvidenceSource: "timesheet", EvidenceReference: "private-timesheet-test"}
	if err := applyTestAction(t, &c, companyOwner, "admin", a); err == nil {
		t.Fatal("self review assignment accepted")
	}
	a.ReviewerID = companyReviewer
	if err := applyTestAction(t, &c, companyOwner, "admin", a); err != nil {
		t.Fatal(err)
	}
	if c.Requests[0].Delivery.CalibrationEligible {
		t.Fatal("pending actuals became eligible")
	}
	approval := companyAction{Action: "delivery.review", RequestID: companyOther, Decision: "approved", Note: "Reconciled against the original work and recorded timesheet."}
	if err := applyTestAction(t, &c, companyOwner, "admin", approval); err == nil {
		t.Fatal("owner approved own actuals")
	}
	if err := applyTestAction(t, &c, companyReviewer, "reviewer", approval); err != nil {
		t.Fatal(err)
	}
	if !c.Requests[0].Delivery.CalibrationEligible {
		t.Fatal("independent approval not eligible")
	}
	c.Config.Tasks[0].BaseHours = 100
	after, _ := json.Marshal(c.Requests[0].Baselines[0])
	// A snapshot is deep-copied through the persistence boundary between requests.
	var persisted WorkflowCompany
	raw, _ := json.Marshal(c)
	_ = json.Unmarshal(raw, &persisted)
	_ = persisted
	if bytes.Equal(original, after) {
		return
	}
	// Sharing slices within one in-memory mutation must not alter a frozen snapshot either.
	t.Fatal("configuration edit changed a frozen baseline")
}
func TestCompanyHistoryExcludesHoldoutAndSynthetic(t *testing.T) {
	c := workflowFixture()
	r := CompanyRequest{ID: "current", Review: workflowReview()}
	b := CompanyBaseline{ID: "baseline", Review: workflowReview(), Estimate: CompanyEstimate{Tasks: []CompanyEstimateTask{{Category: "map", TemplateID: "mapping", Base: 10}}}}
	c.Requests = []CompanyRequest{{ID: "past", Baselines: []CompanyBaseline{b}, Delivery: &deliveryOutcome{BaselineID: "baseline", ReviewStatus: "approved", CalibrationEligible: true, EvaluationSplit: "holdout", ActualHours: map[string]float64{"map": 30}}}}
	e, err := estimateCompanyRequest(&c, r)
	if err != nil || e.Tasks[0].Factor != 1 {
		t.Fatal("holdout leaked into training")
	}
	c.Requests[0].Delivery.EvaluationSplit = "training"
	c.Requests[0].Delivery.Synthetic = true
	e, _ = estimateCompanyRequest(&c, r)
	if e.Tasks[0].Factor != 1 {
		t.Fatal("synthetic leaked into recorded training")
	}
	c.Requests[0].Delivery.Synthetic = false
	e, _ = estimateCompanyRequest(&c, r)
	if e.Tasks[0].Factor <= 1 || e.Tasks[0].Observations != 1 {
		t.Fatal("eligible training history was not used")
	}
	c.Requests[0].Delivery.CalibrationEligible = false
	e, _ = estimateCompanyRequest(&c, r)
	if e.Tasks[0].Factor != 1 {
		t.Fatal("ineligible actuals leaked into training")
	}
}
func TestCompanyKnowledgeAndConditionalFields(t *testing.T) {
	c := workflowFixture()
	c.Knowledge = []KnowledgeDocument{{ID: "draft", Title: "Sync", Status: "draft", Text: "Salesforce sends investor contacts through a configured invitation workflow."}, {ID: "approved", Title: "Salesforce workflow", Status: "approved", Text: "Salesforce sends investor contacts through a configured invitation workflow."}}
	rows := searchCompanyKnowledge(&c, "Salesforce investor")
	if len(rows) != 1 || rows[0].SourceID != "approved" {
		t.Fatal("unapproved knowledge exposed")
	}
	c.Config.Fields = append(c.Config.Fields, IntakeField{Key: "system", Label: "System", Type: "string", Required: true, RequestTypes: []string{"integration"}, RequiredWhen: map[string]string{"outcome": "Import contacts"}})
	if err := validateCompanyReview(c.Config, workflowReview()); err == nil {
		t.Fatal("conditional required field was ignored")
	}
	r := workflowReview()
	r.Fields["system"] = "CRM"
	if err := validateCompanyReview(c.Config, r); err != nil {
		t.Fatal(err)
	}
	schema := companyIntakeSchema(c.Config)
	if len(schema["allOf"].([]any)) != 1 {
		t.Fatal("conditional rule missing from JSON Schema")
	}
	c.Config.ApprovedDomains = []string{"127.0.0.1:1234"}
	if validateCompanyConfig(c.Config) == nil {
		t.Fatal("invalid approved host accepted")
	}
}
func TestCompanyWebhookExpiryAndTampering(t *testing.T) {
	at := time.Now().UTC().Truncate(time.Second)
	stamp := at.Format(time.RFC3339)
	body := []byte(`{"submissionId":"synthetic-1"}`)
	mac := hmac.New(sha256.New, []byte("synthetic-secret"))
	mac.Write([]byte(stamp + "."))
	mac.Write(body)
	signature := hex.EncodeToString(mac.Sum(nil))
	if !verifyWebhook("synthetic-secret", stamp, signature, body, at) {
		t.Fatal("valid signature rejected")
	}
	if verifyWebhook("synthetic-secret", stamp, signature, []byte("changed"), at) || verifyWebhook("synthetic-secret", stamp, signature, body, at.Add(6*time.Minute)) {
		t.Fatal("tampered or expired signature accepted")
	}
}
func TestKnowledgeSearchRetainsLongParagraphEvidence(t *testing.T) {
	c := workflowFixture()
	evidence := "Salesforce investor contact reconciliation is available in the approved sandbox."
	c.Knowledge = []KnowledgeDocument{{ID: "tail", Status: "approved", Title: "Long policy", Text: strings.Repeat("普通 information ", 450) + evidence}}
	found := searchCompanyKnowledge(&c, "Salesforce reconciliation")
	if len(found) == 0 || !strings.Contains(found[0].Passage, evidence) {
		t.Fatal("long source tail was dropped from retrieval")
	}
	if len(searchCompanyKnowledge(&c, "please the and with our request")) != 0 {
		t.Fatal("stop words produced unsupported matches")
	}
}
func TestCompanyCalendarUsesExplicitStaffingAssumptions(t *testing.T) {
	c := workflowFixture()
	c.Requests = []CompanyRequest{{ID: companyOther, Revision: 1, Review: workflowReview()}}
	c.Requests[0].Review.ConfigVersion = c.Config.Version
	if err := applyTestAction(t, &c, companyOwner, "admin", companyAction{Action: "estimate", RequestID: companyOther, StaffCount: 2, DependencyDays: 3}); err != nil {
		t.Fatal(err)
	}
	e := c.Requests[0].Estimate
	if e.StaffCount != 2 || e.PlanningDays != 10.0/(6*2)+3 {
		t.Fatal("calendar scenario ignored configured hours, staffing, or delay")
	}
}
func TestProjectedDeliveryDateSkipsWeekends(t *testing.T) {
	start, err := time.Parse("2006-01-02", "2026-10-23") // Friday
	if err != nil {
		t.Fatal(err)
	}
	got := projectedWorkdayDate(start, 3).Format("2006-01-02")
	if got != "2026-10-27" { // Friday, Monday, Tuesday
		t.Fatalf("expected Tuesday finish after three working days, got %s", got)
	}
}
func TestRetentionPolicyPrunesRequestsAfterConfiguredAge(t *testing.T) {
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	c := WorkflowCompany{Config: CompanyConfig{RetentionDays: 30}, Requests: []CompanyRequest{
		{ID: "expired", UpdatedAt: now.Add(-31 * 24 * time.Hour)},
		{ID: "retained", UpdatedAt: now.Add(-29 * 24 * time.Hour)},
	}}
	pruneCompany(&c, now)
	if len(c.Requests) != 1 || c.Requests[0].ID != "retained" {
		t.Fatalf("expected only the in-retention request to remain, got %#v", c.Requests)
	}
}
func TestRetiredKnowledgeBlocksNewFreeze(t *testing.T) {
	c := workflowFixture()
	c.Requests = []CompanyRequest{{ID: companyOther, Revision: 1, Review: workflowReview(), Knowledge: []KnowledgePassage{{SourceID: "retired", SHA256: "digest"}}}}
	c.Requests[0].Review.ConfigVersion = 1
	c.Knowledge = []KnowledgeDocument{{ID: "retired", Status: "approved", SHA256: "digest"}}
	if err := applyTestAction(t, &c, companyOwner, "admin", companyAction{Action: "estimate", RequestID: companyOther}); err != nil {
		t.Fatal(err)
	}
	c.Knowledge[0].Status = "retired"
	if err := applyTestAction(t, &c, companyOwner, "admin", companyAction{Action: "freeze", RequestID: companyOther}); err == nil {
		t.Fatal("retired knowledge entered a new frozen estimate")
	}
}
func TestAutomaticAnalysisDoesNotOverwriteHumanReview(t *testing.T) {
	c := workflowFixture()
	c.Requests = []CompanyRequest{{ID: companyOther, Revision: 2, Status: "reviewed", Review: workflowReview(), UpdatedAt: time.Now()}}
	automatic := companyAction{Action: "analysis.started", RequestID: companyOther, Automatic: true, ExpectedRevision: 2}
	if err := applyTestAction(t, &c, companyOwner, "admin", automatic); err == nil {
		t.Fatal("stale automatic job overwrote a human-reviewed request")
	}
	if c.Requests[0].Status != "reviewed" || !c.Requests[0].Review.Confirmed {
		t.Fatal("review changed despite rejected job")
	}
	c.Requests[0].Status = "received"
	if err := applyTestAction(t, &c, companyOwner, "admin", automatic); err != nil {
		t.Fatal(err)
	}
	if c.Requests[0].Status != "analyzing" || c.Requests[0].AnalysisAttempts != 1 {
		t.Fatal("queued email did not begin analysis")
	}
}
func TestCompanyAnalysisRetryScheduling(t *testing.T) {
	now := time.Now()
	later := now.Add(time.Minute)
	r := CompanyRequest{Status: "failed", AnalysisAttempts: 1, NextAttemptAt: &later}
	if companyAnalysisDue(r, now) {
		t.Fatal("failure retried before its backoff expired")
	}
	earlier := now.Add(-time.Second)
	r.NextAttemptAt = &earlier
	if !companyAnalysisDue(r, now) {
		t.Fatal("due failure did not retry")
	}
	r.AnalysisAttempts = 3
	if companyAnalysisDue(r, now) {
		t.Fatal("failed outcome exceeded automatic retry limit")
	}
	r.Status = "received"
	r.Delivery = &deliveryOutcome{}
	if companyAnalysisDue(r, now) {
		t.Fatal("delivered scope queued for automatic re-analysis")
	}
}
func TestCompanyDatabaseIsolationAndAttachments(t *testing.T) {
	dsn := os.Getenv("WORKFLOW_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set WORKFLOW_TEST_DATABASE_URL to a disposable PostgreSQL database")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err = pool.Exec(context.Background(), companySchema); err != nil {
		t.Fatal(err)
	}
	key := bytes.Repeat([]byte{42}, 32)
	store := &recordStore{pool: pool, contentKey: key, identityKey: key, serviceTokenKeys: map[string][]byte{"test": key}, retentionDays: 90}
	ids := []string{}
	defer func() {
		for _, id := range ids {
			_, _ = pool.Exec(context.Background(), "DELETE FROM workflow_companies WHERE id=$1", id)
		}
	}()
	call := func(actor, method, path string, body any) *httptest.ResponseRecorder {
		var raw []byte
		if body != nil {
			raw, _ = json.Marshal(body)
		}
		scope := "workflow:read"
		if method != "GET" {
			scope = "workflow:write"
		}
		parsed := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"identity_authority": "first-party-v1", "email_verified": true, "scope": scope, "iss": "the-estimator-web", "aud": "the-estimator-go", "sub": actor, "jti": "test-operation", "iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix()})
		parsed.Header["kid"] = "test"
		token, _ := parsed.SignedString(key)
		request := httptest.NewRequest(method, path, bytes.NewReader(raw))
		request.Header.Set("authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		store.handleCompanyWorkflow(response, request)
		return response
	}
	created := call(companyOwner, "POST", "/v1/workflow/companies", map[string]string{"name": "Synthetic isolation company"})
	if created.Code != 201 {
		t.Fatal(created.Code, created.Body.String())
	}
	var company WorkflowCompany
	if json.Unmarshal(created.Body.Bytes(), &company) != nil {
		t.Fatal("invalid create response")
	}
	ids = append(ids, company.ID)
	path := "/v1/workflow/companies/" + company.ID
	if denied := call(companyOther, "GET", path, nil); denied.Code != 404 {
		t.Fatal("cross-company read allowed", denied.Code)
	}
	payload := companyAction{Action: "intake", Channel: "manual", Title: "Synthetic attachment request", Text: "Import our contact data and verify the original fields.", Attachments: []CompanyAttachment{{Name: "request.txt", Type: "txt", Text: "Import our contact data and verify the original fields.", Status: "extracted", ContentBase64: base64.StdEncoding.EncodeToString([]byte("synthetic attachment bytes"))}}}
	saved := call(companyOwner, "POST", path+"/actions", payload)
	if saved.Code != 200 {
		t.Fatal(saved.Code, saved.Body.String())
	}
	if strings.Contains(saved.Body.String(), "contentBase64") {
		t.Fatal("original bytes leaked in state response")
	}
	var result struct {
		Company WorkflowCompany `json:"company"`
	}
	_ = json.Unmarshal(saved.Body.Bytes(), &result)
	id := result.Company.Requests[0].Attachments[0].ID
	download := call(companyOwner, "GET", path+"/attachments/"+id, nil)
	if download.Code != 200 || download.Body.String() != "synthetic attachment bytes" {
		t.Fatal("authorized attachment download failed")
	}
	if denied := call(companyOther, "GET", path+"/attachments/"+id, nil); denied.Code != 404 {
		t.Fatal("cross-company attachment read allowed")
	}
	if unsafe := call(companyOwner, "POST", path+"/actions", map[string]any{"action": "delivery", "requestId": result.Company.Requests[0].ID, "calibrationEligible": true}); unsafe.Code != 400 {
		t.Fatal("client eligibility injection accepted")
	}
	if added := call(companyOwner, "POST", path+"/actions", companyAction{Action: "member", AccountID: companyOther, Role: "member"}); added.Code != 200 {
		t.Fatal(added.Code, added.Body.String())
	}
	if denied := call(companyOther, "POST", path+"/actions", companyAction{Action: "config", Config: company.Config}); denied.Code != 403 {
		t.Fatal("non-admin configuration write accepted")
	}
	if demote := call(companyOwner, "POST", path+"/actions", companyAction{Action: "member", AccountID: companyOwner, Role: "member"}); demote.Code != 400 {
		t.Fatal("last admin demotion accepted")
	}
	var ciphertext []byte
	if pool.QueryRow(context.Background(), "SELECT ciphertext FROM workflow_companies WHERE id=$1", company.ID).Scan(&ciphertext) != nil {
		t.Fatal("ciphertext missing")
	}
	if bytes.Contains(ciphertext, []byte(payload.Text)) {
		t.Fatal("client text stored as plaintext")
	}
}
