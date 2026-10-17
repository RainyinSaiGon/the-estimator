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
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/001_private_records.sql
var privateRecordSchema string

type recordStore struct {
	pool          *pgxpool.Pool
	serviceSecret []byte
	contentKey    []byte
	identityKey   []byte
	retentionDays int
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

type recordSummary struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func openRecordStore() (*recordStore, error) {
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	serviceSecret := strings.TrimSpace(os.Getenv("SERVICE_TOKEN_SECRET"))
	contentKeyValue := strings.TrimSpace(os.Getenv("CLIENT_CONTENT_KEY"))
	identityKeyValue := strings.TrimSpace(os.Getenv("IDENTITY_INDEX_KEY"))
	if databaseURL == "" && serviceSecret == "" && contentKeyValue == "" && identityKeyValue == "" {
		return nil, nil
	}
	if databaseURL == "" || serviceSecret == "" || contentKeyValue == "" || identityKeyValue == "" {
		return nil, errors.New("private-record configuration is incomplete")
	}
	if len([]byte(serviceSecret)) < 32 {
		return nil, errors.New("service-token secret must contain at least 32 bytes")
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
	store := &recordStore{pool: pool, serviceSecret: []byte(serviceSecret), contentKey: contentKey, identityKey: identityKey, retentionDays: retentionDays}
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
	if err := store.cleanupExpiredRecords(ctx); err != nil {
		slog.Error("private_record_startup_cleanup_failed", "service", "estimator-go")
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
	case http.MethodDelete:
		store.deleteRecord(w, r, principal, recordID)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed."})
	}
}

func (store *recordStore) authorize(w http.ResponseWriter, r *http.Request) (recordPrincipal, bool) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") || len(header) > 10_000 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Sign in to access your private workspace."})
		return recordPrincipal{}, false
	}
	principal, err := verifyServiceToken(strings.TrimPrefix(header, "Bearer "), store.serviceSecret, time.Now())
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Sign in again to access private records."})
		return recordPrincipal{}, false
	}
	return principal, true
}

func verifyServiceToken(token string, secret []byte, now time.Time) (recordPrincipal, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || len(parts[0]) > 2048 || len(parts[1]) > 8192 || len(parts[2]) > 256 {
		return recordPrincipal{}, errors.New("invalid token")
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return recordPrincipal{}, errors.New("invalid token")
	}
	var header struct {
		Algorithm string `json:"alg"`
		Type      string `json:"typ"`
	}
	if json.Unmarshal(headerBytes, &header) != nil || header.Algorithm != "HS256" || header.Type != "JWT" {
		return recordPrincipal{}, errors.New("invalid token")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return recordPrincipal{}, errors.New("invalid token")
	}
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return recordPrincipal{}, errors.New("invalid token")
	}
	claimsBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return recordPrincipal{}, errors.New("invalid token")
	}
	decoder := json.NewDecoder(bytes.NewReader(claimsBytes))
	decoder.UseNumber()
	var claims map[string]any
	if decoder.Decode(&claims) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		return recordPrincipal{}, errors.New("invalid token")
	}
	issuer, _ := claims["iss"].(string)
	subject, _ := claims["sub"].(string)
	identityIssuer, _ := claims["oidc_issuer"].(string)
	jti, _ := claims["jti"].(string)
	audienceOK := false
	switch value := claims["aud"].(type) {
	case string:
		audienceOK = value == "the-estimator-go"
	case []any:
		for _, item := range value {
			if item == "the-estimator-go" {
				audienceOK = true
			}
		}
	}
	expiration, expOK := numericClaim(claims["exp"])
	issuedAt, iatOK := numericClaim(claims["iat"])
	unixNow := now.Unix()
	notBeforeOK := true
	if rawNotBefore, exists := claims["nbf"]; exists {
		notBefore, ok := numericClaim(rawNotBefore)
		notBeforeOK = ok && notBefore <= unixNow+30
	}
	if issuer != "the-estimator-web" || !audienceOK || !expOK || !iatOK || !notBeforeOK || expiration <= unixNow-30 || issuedAt > unixNow+30 || expiration <= issuedAt || expiration-issuedAt > 120 || subject == "" || len(subject) > 512 || jti == "" || len(jti) > 128 || !validOIDCIssuer(identityIssuer) {
		return recordPrincipal{}, errors.New("invalid token")
	}
	return recordPrincipal{issuer: identityIssuer, subject: subject}, nil
}

func numericClaim(value any) (int64, bool) {
	number, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	parsed, err := number.Int64()
	return parsed, err == nil
}

func validOIDCIssuer(value string) bool {
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	return parsed.Scheme == "https" || (parsed.Scheme == "http" && (parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1"))
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
	if err := decoder.Decode(&request); err != nil || decoder.Decode(&struct{}{}) != io.EOF || request.SchemaVersion != 1 || !request.ReviewConfirmed || !json.Valid(request.Payload) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Provide a valid version 1 estimate snapshot."})
		return
	}
	var payload recordPayload
	if err := json.Unmarshal(request.Payload, &payload); err != nil || !validRecordPayload(payload) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The saved estimate snapshot is incomplete."})
		return
	}
	var normalized bytes.Buffer
	if err := json.Compact(&normalized, request.Payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The saved estimate snapshot is invalid."})
		return
	}
	recordID, err := newUUID()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The private estimate could not be saved."})
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
	nonce, ciphertext, err := store.encryptField(accountID, recordID, "payload", normalized.Bytes())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The private estimate could not be saved."})
		return
	}
	expiresAt := time.Now().UTC().AddDate(0, 0, store.retentionDays)
	_, err = tx.Exec(ctx, `INSERT INTO estimator_records (id, account_id, schema_version, title_nonce, title_ciphertext, content_nonce, content_ciphertext, created_at, expires_at) VALUES ($1, $2, 1, $3, $4, $5, $6, now(), $7)`, recordID, accountID, titleNonce, titleCiphertext, nonce, ciphertext, expiresAt)
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
	if payload.SchemaVersion != 1 || title == "" || len([]rune(title)) > 200 || strings.ContainsAny(title, "\r\n") {
		return false
	}
	if strings.TrimSpace(payload.Source.Name) == "" || len(payload.Source.Name) > 240 || len(payload.Source.Type) > 40 || payload.Source.Characters < 0 || strings.TrimSpace(payload.Source.ReviewText) == "" || len(payload.Source.ReviewText) > 200_000 {
		return false
	}
	if len(bytes.TrimSpace(payload.OriginalFile)) == 0 || len(bytes.TrimSpace(payload.DeliveryOutcome)) == 0 {
		return false
	}
	if !bytes.Equal(bytes.TrimSpace(payload.DeliveryOutcome), []byte("null")) {
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
