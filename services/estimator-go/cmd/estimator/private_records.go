package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/001_private_records.sql
var privateRecordSchema string

//go:embed migrations/002_lifecycle.sql
var privateRecordLifecycleSchema string

type recordStore struct {
	pool             *pgxpool.Pool
	serviceTokenKeys map[string][]byte
	contentKey       []byte
	identityKey      []byte
	retentionDays    int
}

type recordPrincipal struct {
	issuer  string
	subject string
}

type recordPayload struct {
	SchemaVersion   int             `json:"schemaVersion"`
	Title           string          `json:"title"`
	Source          recordSource    `json:"source"`
	OriginalFile    json.RawMessage `json:"originalFile"`
	SuggestedScope  json.RawMessage `json:"suggestedScope"`
	ReviewedScope   json.RawMessage `json:"reviewedScope"`
	Estimate        json.RawMessage `json:"estimate"`
	DeliveryOutcome json.RawMessage `json:"deliveryOutcome"`
	Baseline        json.RawMessage `json:"baseline"`
	Provenance      json.RawMessage `json:"provenance"`
	ReviewDecisions json.RawMessage `json:"reviewDecisions"`
}

type recordSource struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Characters int    `json:"characters"`
	Truncated  bool   `json:"truncated"`
	ReviewText string `json:"reviewText"`
}

type createRecordRequest struct {
	SchemaVersion   int             `json:"schemaVersion"`
	ReviewConfirmed bool            `json:"reviewConfirmed"`
	Payload         json.RawMessage `json:"payload"`
}

type updateRecordRequest struct {
	Title string `json:"title"`
}

type recordSummary struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func openRecordStore() (*recordStore, error) {
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	serviceSecret := strings.TrimSpace(os.Getenv("SERVICE_TOKEN_SECRET"))
	serviceTokenKeyID := strings.TrimSpace(os.Getenv("SERVICE_TOKEN_KEY_ID"))
	serviceTokenVerificationKeys := strings.TrimSpace(os.Getenv("SERVICE_TOKEN_VERIFICATION_KEYS"))
	contentKeyValue := strings.TrimSpace(os.Getenv("CLIENT_CONTENT_KEY"))
	identityKeyValue := strings.TrimSpace(os.Getenv("IDENTITY_INDEX_KEY"))
	if databaseURL == "" && serviceSecret == "" && serviceTokenKeyID == "" && serviceTokenVerificationKeys == "" && contentKeyValue == "" && identityKeyValue == "" {
		return nil, nil
	}
	if databaseURL == "" || serviceSecret == "" || contentKeyValue == "" || identityKeyValue == "" {
		return nil, errors.New("private-record configuration is incomplete")
	}
	if serviceTokenKeyID == "" {
		serviceTokenKeyID = "legacy"
	}
	serviceTokenKeys, err := configuredServiceTokenKeys(serviceTokenKeyID, serviceSecret, serviceTokenVerificationKeys)
	if err != nil {
		return nil, err
	}
	contentKey, err := base64.StdEncoding.DecodeString(contentKeyValue)
	if err != nil || len(contentKey) != 32 {
		return nil, errors.New("client-content key must be a base64-encoded 32-byte key")
	}
	identityKey, err := base64.StdEncoding.DecodeString(identityKeyValue)
	if err != nil || len(identityKey) != 32 {
		return nil, errors.New("identity-index key must be a base64-encoded 32-byte key")
	}
	retentionDays := 90
	if value := strings.TrimSpace(os.Getenv("RECORD_RETENTION_DAYS")); value != "" {
		parsed, parseErr := strconv.Atoi(value)
		if parseErr != nil || parsed < 1 || parsed > 3650 {
			return nil, errors.New("record-retention days must be between 1 and 3650")
		}
		retentionDays = parsed
	}
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, errors.New("database URL is invalid")
	}
	poolConfig.MaxConns = 10
	poolConfig.MinConns = 0
	poolConfig.MaxConnLifetime = time.Hour
	poolConfig.MaxConnIdleTime = 5 * time.Minute
	pool, err := pgxpool.NewWithConfig(context.Background(), poolConfig)
	if err != nil {
		return nil, errors.New("database pool could not be started")
	}
	store := &recordStore{pool: pool, serviceTokenKeys: serviceTokenKeys, contentKey: contentKey, identityKey: identityKey, retentionDays: retentionDays}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, errors.New("private-record database is not reachable")
	}
	if _, err := pool.Exec(ctx, privateRecordSchema); err != nil {
		pool.Close()
		return nil, errors.New("private-record schema could not be initialized")
	}
	if _, err := pool.Exec(ctx, privateRecordLifecycleSchema); err != nil {
		pool.Close()
		return nil, errors.New("private-record lifecycle schema could not be initialized")
	}
	if _, err := pool.Exec(ctx, companySchema); err != nil {
		pool.Close()
		return nil, errors.New("company workflow schema could not be initialized")
	}
	if err := store.cleanupExpiredRecords(ctx); err != nil {
		slog.Error("private_record_startup_cleanup_failed", "service", "estimator-go")
	}
	if err := store.cleanupCompanyRetention(ctx); err != nil {
		slog.Error("company_workflow_startup_cleanup_failed", "service", "estimator-go")
	}
	return store, nil
}

func (store *recordStore) close() {
	if store != nil && store.pool != nil {
		store.pool.Close()
	}
}

func (store *recordStore) cleanupExpiredRecords(ctx context.Context) error {
	if store == nil {
		return nil
	}
	if _, err := store.pool.Exec(ctx, `DELETE FROM estimator_records WHERE expires_at <= now()`); err != nil {
		return err
	}
	_, err := store.pool.Exec(ctx, `DELETE FROM estimator_accounts a WHERE NOT EXISTS (SELECT 1 FROM estimator_records r WHERE r.account_id = a.id)`)
	return err
}

func (store *recordStore) runRetentionCleanup(ctx context.Context) {
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cleanupContext, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := store.cleanupExpiredRecords(cleanupContext)
			if err == nil {
				err = store.cleanupCompanyRetention(cleanupContext)
			}
			cancel()
			if err != nil {
				slog.Error("private_record_retention_cleanup_failed", "service", "estimator-go")
			}
		}
	}
}

func (store *recordStore) handleRecordStatus(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ready := store != nil && store.ready(context.Background())
	retention := 90
	if store != nil {
		retention = store.retentionDays
	}
	writeJSON(w, http.StatusOK, map[string]any{"recordsEnabled": ready, "retentionDays": retention})
}

func (store *recordStore) ready(parent context.Context) bool {
	if store == nil {
		return true
	}
	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()
	return store.pool.Ping(ctx) == nil
}

func (store *recordStore) handleRecords(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Private records are not configured."})
		return
	}
	principal, ok := store.authorize(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		store.listRecords(w, r, principal)
	case http.MethodPost:
		store.createRecord(w, r, principal)
	case http.MethodDelete:
		store.deleteAllRecords(w, r, principal)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed."})
	}
}

func (store *recordStore) handleRecord(w http.ResponseWriter, r *http.Request) {
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
	switch r.Method {
	case http.MethodGet:
		store.getRecord(w, r, principal, recordID)
	case http.MethodPatch:
		store.updateRecord(w, r, principal, recordID)
	case http.MethodDelete:
		store.deleteRecord(w, r, principal, recordID)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed."})
	}
}

func (store *recordStore) authorize(w http.ResponseWriter, r *http.Request) (recordPrincipal, bool) {
	header := r.Header.Get("Authorization")
	requiredScope := requiredRecordScope(r.Method, r.URL.Path)
	if requiredScope == "" || !strings.HasPrefix(header, "Bearer ") || len(header) > 10_000 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Sign in to access your private workspace."})
		return recordPrincipal{}, false
	}
	principal, err := verifyServiceToken(strings.TrimPrefix(header, "Bearer "), store.serviceTokenKeys, requiredScope, time.Now())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Sign in again to access private records."})
		return recordPrincipal{}, false
	}
	return principal, true
}

func verifyServiceToken(token string, keys map[string][]byte, requiredScope string, now time.Time) (recordPrincipal, error) {
	if len(token) == 0 || len(token) > 10_000 {
		return recordPrincipal{}, errors.New("invalid token")
	}
	claims := &recordServiceClaims{}
	parsed, err := jwt.ParseWithClaims(token, claims, func(parsed *jwt.Token) (any, error) {
		if parsed.Method != jwt.SigningMethodHS256 || parsed.Header["typ"] != "JWT" {
			return nil, errors.New("invalid token")
		}
		rawKeyID, exists := parsed.Header["kid"]
		keyID := "legacy"
		if exists {
			var ok bool
			keyID, ok = rawKeyID.(string)
			if !ok {
				return nil, errors.New("invalid token")
			}
		}
		if keyID == "" {
			return nil, errors.New("invalid token")
		}
		secret, ok := keys[keyID]
		if !ok {
			return nil, errors.New("invalid token")
		}
		return secret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithIssuer("the-estimator-web"), jwt.WithAudience("the-estimator-go"), jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithTimeFunc(func() time.Time { return now }))
	if err != nil || parsed == nil || !parsed.Valid {
		return recordPrincipal{}, errors.New("invalid token")
	}
	if claims.IssuedAt == nil || claims.ExpiresAt == nil || !claims.ExpiresAt.Time.After(claims.IssuedAt.Time) || claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time) > 60*time.Second || len(claims.Audience) != 1 || claims.Audience[0] != "the-estimator-go" || claims.ID == "" || len(claims.ID) > 128 || claims.Scope != requiredScope || claims.IdentityAuthority != "first-party-v1" || !claims.EmailVerified || len(claims.OwnerID) > 0 || !isUUID(claims.Subject) {
		return recordPrincipal{}, errors.New("invalid token")
	}
	return recordPrincipal{issuer: claims.IdentityAuthority, subject: claims.Subject}, nil
}

type recordServiceClaims struct {
	IdentityAuthority string          `json:"identity_authority"`
	EmailVerified     bool            `json:"email_verified"`
	Scope             string          `json:"scope"`
	OwnerID           json.RawMessage `json:"owner_id"`
	jwt.RegisteredClaims
}

func requiredRecordScope(method, path string) string {
	switch method {
	case http.MethodGet:
		if path == "/v1/records" || strings.HasPrefix(path, "/v1/records/") {
			return "private-records:read"
		}
	case http.MethodPatch:
		if strings.HasPrefix(path, "/v1/records/") {
			if strings.HasSuffix(path, "/delivery/review") {
				return "private-records:update"
			}
			return "private-records:update"
		}
	case http.MethodPost:
		if path == "/v1/records" {
			return "private-records:create"
		}
		if strings.HasPrefix(path, "/v1/records/") && strings.HasSuffix(path, "/delivery") {
			return "private-records:update"
		}
	case http.MethodDelete:
		if path == "/v1/records" || strings.HasPrefix(path, "/v1/records/") {
			return "private-records:delete"
		}
	}
	return ""
}

func configuredServiceTokenKeys(activeKeyID, activeSecret, verificationKeysJSON string) (map[string][]byte, error) {
	if !validServiceTokenKeyID(activeKeyID) || len([]byte(activeSecret)) < 32 {
		return nil, errors.New("service-token active key ID and secret are invalid")
	}
	keys := map[string][]byte{activeKeyID: []byte(activeSecret)}
	if verificationKeysJSON == "" {
		return keys, nil
	}
	var previous map[string]string
	if len(verificationKeysJSON) > 16*1024 || json.Unmarshal([]byte(verificationKeysJSON), &previous) != nil || previous == nil || len(previous) > 8 {
		return nil, errors.New("service-token verification keys must be a JSON object with at most eight entries")
	}
	for keyID, secret := range previous {
		if !validServiceTokenKeyID(keyID) || len([]byte(secret)) < 32 {
			return nil, errors.New("service-token verification key ID or secret is invalid")
		}
		if active, exists := keys[keyID]; exists && !hmac.Equal(active, []byte(secret)) {
			return nil, errors.New("service-token key ID is configured with conflicting secrets")
		}
		keys[keyID] = []byte(secret)
	}
	return keys, nil
}

func validServiceTokenKeyID(value string) bool {
	if len(value) == 0 || len(value) > 64 {
		return false
	}
	for _, char := range value {
		if char < 'a' || char > 'z' {
			if char < 'A' || char > 'Z' {
				if char < '0' || char > '9' {
					if char != '-' && char != '_' && char != '.' {
						return false
					}
				}
			}
		}
	}
	return true
}

func (store *recordStore) listRecords(w http.ResponseWriter, r *http.Request, principal recordPrincipal) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	ownerKey := store.ownerLookupKey(principal)
	rows, err := store.pool.Query(ctx, `SELECT r.id::text, r.account_id::text, r.title_nonce, r.title_ciphertext, r.created_at, r.expires_at FROM estimator_records r JOIN estimator_accounts a ON a.id = r.account_id WHERE a.owner_key = $1 AND r.expires_at > now() ORDER BY r.created_at DESC LIMIT 200`, ownerKey)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Private estimates could not be loaded."})
		return
	}
	defer rows.Close()
	records := make([]recordSummary, 0)
	for rows.Next() {
		var id, accountID string
		var nonce, ciphertext []byte
		var createdAt, expiresAt time.Time
		if err := rows.Scan(&id, &accountID, &nonce, &ciphertext, &createdAt, &expiresAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Private estimates could not be loaded."})
			return
		}
		titleBytes, err := store.decryptField(accountID, id, "title", nonce, ciphertext)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "A saved estimate could not be listed."})
			return
		}
		records = append(records, recordSummary{ID: id, Title: string(titleBytes), CreatedAt: createdAt.UTC(), ExpiresAt: expiresAt.UTC()})
	}
	if rows.Err() != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Private estimates could not be loaded."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"records": records})
}

func (store *recordStore) createRecord(w http.ResponseWriter, r *http.Request, principal recordPrincipal) {
	r.Body = http.MaxBytesReader(w, r.Body, 15_000_000)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var request createRecordRequest
	if err := decoder.Decode(&request); err != nil || decoder.Decode(&struct{}{}) != io.EOF || (request.SchemaVersion != 1 && request.SchemaVersion != 2) || !request.ReviewConfirmed || !json.Valid(request.Payload) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Provide a valid reviewed estimate snapshot."})
		return
	}
	var payload recordPayload
	if err := json.Unmarshal(request.Payload, &payload); err != nil || payload.SchemaVersion != request.SchemaVersion || !validRecordPayload(payload) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The saved estimate snapshot is incomplete."})
		return
	}
	if !validReviewedScopeEvidence(payload) {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "Every reviewed work item must retain a quote found in the extracted source."})
		return
	}
	recordID, err := newUUID()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The private estimate could not be saved."})
		return
	}
	normalizedPayload, err := initializeRecordLifecycle(request.Payload, payload, recordID, principal, time.Now().UTC())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The estimate provenance could not be initialized."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "The private estimate could not be saved."})
		return
	}
	defer tx.Rollback(ctx)
	accountID, err := store.resolveAccount(ctx, tx, principal)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "The private estimate could not be saved."})
		return
	}
	titleNonce, titleCiphertext, err := store.encryptField(accountID, recordID, "title", []byte(payload.Title))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The private estimate could not be saved."})
		return
	}
	nonce, ciphertext, err := store.encryptField(accountID, recordID, "payload", normalizedPayload)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The private estimate could not be saved."})
		return
	}
	expiresAt := time.Now().UTC().AddDate(0, 0, store.retentionDays)
	_, err = tx.Exec(ctx, `INSERT INTO estimator_records (id, account_id, schema_version, title_nonce, title_ciphertext, content_nonce, content_ciphertext, created_at, expires_at) VALUES ($1, $2, 2, $3, $4, $5, $6, now(), $7)`, recordID, accountID, titleNonce, titleCiphertext, nonce, ciphertext, expiresAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The private estimate could not be saved."})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The private estimate could not be saved."})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": recordID, "title": payload.Title, "createdAt": time.Now().UTC(), "expiresAt": expiresAt})
}

func validRecordPayload(payload recordPayload) bool {
	title := strings.TrimSpace(payload.Title)
	if (payload.SchemaVersion != 1 && payload.SchemaVersion != 2) || title == "" || len([]rune(title)) > 200 || strings.ContainsAny(title, "\r\n") {
		return false
	}
	if strings.TrimSpace(payload.Source.Name) == "" || len(payload.Source.Name) > 240 || len(payload.Source.Type) > 40 || payload.Source.Characters < 0 || payload.Source.Characters != len([]rune(payload.Source.ReviewText)) || strings.TrimSpace(payload.Source.ReviewText) == "" || len(payload.Source.ReviewText) > 200_000 {
		return false
	}
	if len(bytes.TrimSpace(payload.OriginalFile)) == 0 || len(bytes.TrimSpace(payload.DeliveryOutcome)) == 0 {
		return false
	}
	if !bytes.Equal(bytes.TrimSpace(payload.DeliveryOutcome), []byte("null")) {
		if payload.SchemaVersion != 2 || !validDeliveryOutcome(payload.DeliveryOutcome, payload.Baseline) {
			return false
		}
	}
	if payload.SchemaVersion == 2 && len(bytes.TrimSpace(payload.Baseline)) > 0 {
		var baseline frozenRecordBaseline
		var provenance map[string]json.RawMessage
		var decisions []lifecycleReviewDecision
		if json.Unmarshal(payload.Baseline, &baseline) != nil || !isUUID(baseline.ID) || len(baseline.SHA256) != 64 || len(baseline.WorkPackageIDs) == 0 || (baseline.EvaluationSplit != "training" && baseline.EvaluationSplit != "holdout" && baseline.EvaluationSplit != "unassigned") || json.Unmarshal(payload.Provenance, &provenance) != nil || provenance == nil || json.Unmarshal(payload.ReviewDecisions, &decisions) != nil || len(decisions) == 0 {
			return false
		}
	} else if payload.SchemaVersion == 2 && !bytes.Equal(bytes.TrimSpace(payload.DeliveryOutcome), []byte("null")) {
		return false
	}
	var originalFile *recordSourceFile
	if !bytes.Equal(bytes.TrimSpace(payload.OriginalFile), []byte("null")) {
		if json.Unmarshal(payload.OriginalFile, &originalFile) != nil || originalFile == nil || strings.TrimSpace(originalFile.Name) == "" || len(originalFile.Name) > 240 || len(originalFile.Type) > 160 {
			return false
		}
		content, err := base64.StdEncoding.DecodeString(originalFile.ContentBase64)
		if err != nil || len(content) == 0 || len(content) > 10*1024*1024 {
			return false
		}
	}
	for _, value := range []json.RawMessage{payload.SuggestedScope, payload.ReviewedScope, payload.Estimate} {
		trimmed := bytes.TrimSpace(value)
		if len(trimmed) == 0 || trimmed[0] != '{' || !json.Valid(trimmed) {
			return false
		}
	}
	var reviewed struct {
		Requirements []json.RawMessage `json:"requirements"`
	}
	if json.Unmarshal(payload.ReviewedScope, &reviewed) != nil || len(reviewed.Requirements) == 0 || len(reviewed.Requirements) > 30 {
		return false
	}
	if payload.SchemaVersion == 2 && len(bytes.TrimSpace(payload.Baseline)) == 0 {
		var evidenceScope struct {
			Requirements []struct {
				ID       string `json:"id"`
				Evidence string `json:"evidence"`
			} `json:"requirements"`
		}
		if json.Unmarshal(payload.ReviewedScope, &evidenceScope) != nil {
			return false
		}
		for _, requirement := range evidenceScope.Requirements {
			if strings.TrimSpace(requirement.ID) == "" || !hasRecordSourceEvidence(payload.Source.ReviewText, requirement.Evidence) {
				return false
			}
		}
	}
	var estimate struct {
		Hours *float64 `json:"hours"`
		Low   *int     `json:"low"`
		High  *int     `json:"high"`
		Tasks []any    `json:"tasks"`
	}
	if json.Unmarshal(payload.Estimate, &estimate) != nil || estimate.Hours == nil || estimate.Low == nil || estimate.High == nil || len(estimate.Tasks) == 0 || len(estimate.Tasks) > 30 {
		return false
	}
	if *estimate.Hours < 0 || *estimate.Hours > 1_000_000 || *estimate.Low < 0 || *estimate.High < *estimate.Low || *estimate.High > 1_000_000 || *estimate.Hours < float64(*estimate.Low) || *estimate.Hours > float64(*estimate.High) {
		return false
	}
	return true
}

func validReviewedScopeEvidence(payload recordPayload) bool {
	var scope struct {
		Requirements []struct {
			ID       string `json:"id"`
			Evidence string `json:"evidence"`
		} `json:"requirements"`
	}
	if json.Unmarshal(payload.ReviewedScope, &scope) != nil || len(scope.Requirements) == 0 {
		return false
	}
	for _, requirement := range scope.Requirements {
		if strings.TrimSpace(requirement.ID) == "" || !hasRecordSourceEvidence(payload.Source.ReviewText, requirement.Evidence) {
			return false
		}
	}
	return true
}

type recordSourceFile struct {
	Name          string `json:"name"`
	Type          string `json:"type"`
	ContentBase64 string `json:"contentBase64"`
}

func (store *recordStore) getRecord(w http.ResponseWriter, r *http.Request, principal recordPrincipal, recordID string) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var accountID string
	var nonce, ciphertext []byte
	var createdAt, expiresAt time.Time
	err := store.pool.QueryRow(ctx, `SELECT r.account_id::text, r.content_nonce, r.content_ciphertext, r.created_at, r.expires_at FROM estimator_records r JOIN estimator_accounts a ON a.id = r.account_id WHERE r.id = $1 AND a.owner_key = $2 AND r.expires_at > now()`, recordID, store.ownerLookupKey(principal)).Scan(&accountID, &nonce, &ciphertext, &createdAt, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Private estimate not found."})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Private estimate could not be loaded."})
		return
	}
	payload, err := store.decryptField(accountID, recordID, "payload", nonce, ciphertext)
	if err != nil || !json.Valid(payload) {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The private estimate could not be opened."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": recordID, "payload": json.RawMessage(payload), "createdAt": createdAt.UTC(), "expiresAt": expiresAt.UTC()})
}

func (store *recordStore) updateRecord(w http.ResponseWriter, r *http.Request, principal recordPrincipal, recordID string) {
	r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var input updateRecordRequest
	if err := decoder.Decode(&input); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "The private-record request is too large."})
		} else {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Provide a valid private estimate title."})
		}
		return
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Provide a valid private estimate title."})
		return
	}
	title := strings.TrimSpace(input.Title)
	if title == "" || len([]rune(title)) > 200 || strings.ContainsAny(title, "\r\n") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Provide a title between 1 and 200 characters."})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Private estimate could not be updated."})
		return
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	var accountID string
	var nonce, ciphertext []byte
	err = tx.QueryRow(ctx, `SELECT r.account_id::text, r.content_nonce, r.content_ciphertext FROM estimator_records r JOIN estimator_accounts a ON a.id = r.account_id WHERE r.id = $1 AND a.owner_key = $2 AND r.expires_at > now() FOR UPDATE OF r`, recordID, store.ownerLookupKey(principal)).Scan(&accountID, &nonce, &ciphertext)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Private estimate not found."})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Private estimate could not be updated."})
		return
	}
	payloadBytes, err := store.decryptField(accountID, recordID, "payload", nonce, ciphertext)
	var payload recordPayload
	if err != nil || json.Unmarshal(payloadBytes, &payload) != nil || !validRecordPayload(payload) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "The private estimate could not be safely updated."})
		return
	}
	var payloadFields map[string]json.RawMessage
	if err := json.Unmarshal(payloadBytes, &payloadFields); err != nil || payloadFields == nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "The private estimate could not be safely updated."})
		return
	}
	encodedTitle, err := json.Marshal(title)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Private estimate could not be updated."})
		return
	}
	payloadFields["title"] = encodedTitle
	updatedPayload, err := json.Marshal(payloadFields)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Private estimate could not be updated."})
		return
	}
	titleNonce, titleCiphertext, err := store.encryptField(accountID, recordID, "title", []byte(title))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Private estimate could not be updated."})
		return
	}
	payloadNonce, payloadCiphertext, err := store.encryptField(accountID, recordID, "payload", updatedPayload)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Private estimate could not be updated."})
		return
	}
	if _, err = tx.Exec(ctx, `UPDATE estimator_records SET title_nonce = $1, title_ciphertext = $2, content_nonce = $3, content_ciphertext = $4 WHERE id = $5 AND account_id = $6 AND expires_at > now()`, titleNonce, titleCiphertext, payloadNonce, payloadCiphertext, recordID, accountID); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Private estimate could not be updated."})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Private estimate could not be updated."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": recordID, "title": title})
}

func (store *recordStore) deleteRecord(w http.ResponseWriter, r *http.Request, principal recordPrincipal, recordID string) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	ownerKey := store.ownerLookupKey(principal)
	result, err := store.pool.Exec(ctx, `DELETE FROM estimator_records r USING estimator_accounts a WHERE r.account_id = a.id AND r.id = $1 AND a.owner_key = $2`, recordID, ownerKey)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Private estimate could not be deleted."})
		return
	}
	if result.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Private estimate not found."})
		return
	}
	store.deleteEmptyAccount(ctx, ownerKey)
	w.WriteHeader(http.StatusNoContent)
}

func (store *recordStore) deleteAllRecords(w http.ResponseWriter, r *http.Request, principal recordPrincipal) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	_, err := store.pool.Exec(ctx, `DELETE FROM estimator_accounts WHERE owner_key = $1`, store.ownerLookupKey(principal))
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Private workspace could not be deleted."})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (store *recordStore) resolveAccount(ctx context.Context, tx pgx.Tx, principal recordPrincipal) (string, error) {
	accountID, err := newUUID()
	if err != nil {
		return "", err
	}
	var resolved string
	ownerKey := store.ownerLookupKey(principal)
	err = tx.QueryRow(ctx, `INSERT INTO estimator_accounts (id, owner_key, created_at) VALUES ($1, $2, now()) ON CONFLICT (owner_key) DO UPDATE SET owner_key = EXCLUDED.owner_key RETURNING id::text`, accountID, ownerKey).Scan(&resolved)
	return resolved, err
}

func (store *recordStore) ownerLookupKey(principal recordPrincipal) string {
	mac := hmac.New(sha256.New, store.identityKey)
	_, _ = mac.Write([]byte(principal.issuer))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(principal.subject))
	return hex.EncodeToString(mac.Sum(nil))
}

func (store *recordStore) deleteEmptyAccount(ctx context.Context, ownerKey string) {
	_, _ = store.pool.Exec(ctx, `DELETE FROM estimator_accounts a WHERE a.owner_key = $1 AND NOT EXISTS (SELECT 1 FROM estimator_records r WHERE r.account_id = a.id)`, ownerKey)
}

func (store *recordStore) encryptField(accountID, recordID, field string, plaintext []byte) ([]byte, []byte, error) {
	block, err := aes.NewCipher(store.contentKey)
	if err != nil {
		return nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, err
	}
	additionalData := []byte("the-estimator:private-record:v1:" + field + ":" + accountID + ":" + recordID)
	ciphertext := gcm.Seal(nil, nonce, plaintext, additionalData)
	return nonce, ciphertext, nil
}

func (store *recordStore) decryptField(accountID, recordID, field string, nonce, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(store.contentKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(nonce) != gcm.NonceSize() {
		return nil, errors.New("invalid encrypted record")
	}
	additionalData := []byte("the-estimator:private-record:v1:" + field + ":" + accountID + ":" + recordID)
	return gcm.Open(nil, nonce, ciphertext, additionalData)
}

func newUUID() (string, error) {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", id[0:4], id[4:6], id[6:8], id[8:10], id[10:16]), nil
}

func isUUID(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}
	_, err := hex.DecodeString(strings.ReplaceAll(value, "-", ""))
	return err == nil
}
