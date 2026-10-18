package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io/fs"
	"net/http"
	"net/mail"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/argon2"
)

const (
	argonMemoryKiB     = 19 * 1024
	argonIterations    = 2
	argonParallelism   = 1
	argonKeyBytes      = 32
	argonSaltBytes     = 16
	sessionTokenBytes  = 32
	sessionAbsoluteTTL = 30 * 24 * time.Hour
)

type identityStore struct {
	pool       *pgxpool.Pool
	bffSecret  []byte
	sessionTTL time.Duration
	dummySalt  []byte
	dummyHash  []byte
}

type account struct {
	ID          string `json:"accountId"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
}

type authResponse struct {
	Account      account   `json:"account"`
	SessionToken string    `json:"sessionToken"`
	ExpiresAt    time.Time `json:"expiresAt"`
}

type registerRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func openIdentityStore(migrations embed.FS) (*identityStore, error) {
	databaseURL := strings.TrimSpace(os.Getenv("IDENTITY_DATABASE_URL"))
	bffSecret := strings.TrimSpace(os.Getenv("IDENTITY_BFF_SHARED_SECRET"))
	if databaseURL == "" || len([]byte(bffSecret)) < 32 {
		return nil, errors.New("identity database and a 32-byte BFF secret are required")
	}
	sessionTTL := 8 * time.Hour
	if value := strings.TrimSpace(os.Getenv("IDENTITY_SESSION_TTL")); value != "" {
		parsed, err := time.ParseDuration(value)
		if err != nil || parsed < 15*time.Minute || parsed > 24*time.Hour {
			return nil, errors.New("identity session lifetime must be between 15 minutes and 24 hours")
		}
		sessionTTL = parsed
	}
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, errors.New("identity database URL is invalid")
	}
	poolConfig.MaxConns = 10
	poolConfig.MinConns = 0
	poolConfig.MaxConnLifetime = time.Hour
	poolConfig.MaxConnIdleTime = 5 * time.Minute
	pool, err := pgxpool.NewWithConfig(context.Background(), poolConfig)
	if err != nil {
		return nil, errors.New("identity database pool could not be started")
	}
	store := &identityStore{pool: pool, bffSecret: []byte(bffSecret), sessionTTL: sessionTTL}
	store.dummySalt = make([]byte, argonSaltBytes)
	if _, err := rand.Read(store.dummySalt); err != nil {
		pool.Close()
		return nil, errors.New("identity initialization failed")
	}
	store.dummyHash = argon2.IDKey([]byte("not-a-valid-password"), store.dummySalt, argonIterations, argonMemoryKiB, argonParallelism, argonKeyBytes)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, errors.New("identity database is not reachable")
	}
	schema, err := fs.ReadFile(migrations, "migrations/001_identity.sql")
	if err != nil {
		pool.Close()
		return nil, errors.New("identity schema is unavailable")
	}
	if _, err := pool.Exec(ctx, string(schema)); err != nil {
		pool.Close()
		return nil, errors.New("identity schema could not be initialized")
	}
	return store, nil
}

func (store *identityStore) close() {
	store.pool.Close()
}

func (store *identityStore) registerAccount(w http.ResponseWriter, r *http.Request) {
	var input registerRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	email, err := normalizeEmail(input.Email)
	displayName := strings.TrimSpace(input.DisplayName)
	if err != nil || len(displayName) == 0 || utf8.RuneCountInString(displayName) > 100 || !validPassword(input.Password) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Provide a valid email, display name, and password of at least 12 characters."})
		return
	}
	salt := make([]byte, argonSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The account could not be created."})
		return
	}
	hash := argon2.IDKey([]byte(input.Password), salt, argonIterations, argonMemoryKiB, argonParallelism, argonKeyBytes)
	accountID, err := newUUID()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The account could not be created."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `INSERT INTO identity_accounts (id, email_normalized, display_name, password_salt, password_hash) VALUES ($1, $2, $3, $4, $5)`, accountID, email, displayName, salt, hash)
	if err != nil {
		if isUniqueViolation(err) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "An account could not be created with these details."})
			return
		}
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	result, err := store.createSessionForAccount(ctx, tx, account{ID: accountID, Email: email, DisplayName: displayName})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The account could not be created."})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (store *identityStore) createSession(w http.ResponseWriter, r *http.Request) {
	var input loginRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	email, err := normalizeEmail(input.Email)
	if err != nil || len(input.Password) == 0 || len(input.Password) > 1024 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "The email or password is incorrect."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	retryAfterSeconds, err := store.consumeLoginAttempt(ctx, email)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if retryAfterSeconds > 0 {
		w.Header().Set("retry-after", strconv.Itoa(retryAfterSeconds))
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Too many sign-in attempts. Try again later."})
		return
	}
	var result account
	var salt, storedHash []byte
	err = store.pool.QueryRow(ctx, `SELECT id::text, email_normalized, display_name, password_salt, password_hash FROM identity_accounts WHERE email_normalized = $1`, email).Scan(&result.ID, &result.Email, &result.DisplayName, &salt, &storedHash)
	if errors.Is(err, pgx.ErrNoRows) {
		dummy := argon2.IDKey([]byte(input.Password), store.dummySalt, argonIterations, argonMemoryKiB, argonParallelism, argonKeyBytes)
		_ = subtle.ConstantTimeCompare(dummy, store.dummyHash)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "The email or password is incorrect."})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	computed := argon2.IDKey([]byte(input.Password), salt, argonIterations, argonMemoryKiB, argonParallelism, uint32(len(storedHash)))
	if subtle.ConstantTimeCompare(computed, storedHash) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "The email or password is incorrect."})
		return
	}
	if err := store.clearLoginAttempts(ctx, email); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	response, err := store.createSessionForAccount(ctx, store.pool, result)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "A sign-in session could not be created."})
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

func (store *identityStore) currentSession(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r.Header.Get("authorization"))
	if token == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Sign in to continue."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	var result account
	var expiresAt time.Time
	err := store.pool.QueryRow(ctx, `SELECT a.id::text, a.email_normalized, a.display_name, s.expires_at FROM identity_sessions s JOIN identity_accounts a ON a.id = s.account_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, hashSession(token)).Scan(&result.ID, &result.Email, &result.DisplayName, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Sign in to continue."})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"account": result, "expiresAt": expiresAt.UTC()})
}

func (store *identityStore) renewSession(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r.Header.Get("authorization"))
	if token == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Sign in to continue."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var result account
	var absoluteExpiresAt time.Time
	err = tx.QueryRow(ctx, `SELECT a.id::text, a.email_normalized, a.display_name, s.absolute_expires_at FROM identity_sessions s JOIN identity_accounts a ON a.id = s.account_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND s.absolute_expires_at > now() + interval '1 minute' FOR UPDATE OF s`, hashSession(token)).Scan(&result.ID, &result.Email, &result.DisplayName, &absoluteExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Sign in to continue."})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}

	secret := make([]byte, sessionTokenBytes)
	if _, err := rand.Read(secret); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The session could not be renewed."})
		return
	}
	newToken := base64.RawURLEncoding.EncodeToString(secret)
	newSessionID, err := newUUID()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The session could not be renewed."})
		return
	}
	_, err = tx.Exec(ctx, `UPDATE identity_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, hashSession(token))
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	expiresAt := time.Now().UTC().Add(store.sessionTTL)
	if expiresAt.After(absoluteExpiresAt) {
		expiresAt = absoluteExpiresAt
	}
	_, err = tx.Exec(ctx, `INSERT INTO identity_sessions (id, account_id, token_hash, expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $5)`, newSessionID, result.ID, hashSession(newToken), expiresAt, absoluteExpiresAt)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	writeJSON(w, http.StatusOK, authResponse{Account: result, SessionToken: newToken, ExpiresAt: expiresAt})
}

func (store *identityStore) revokeSession(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r.Header.Get("authorization"))
	if token == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	_, err := store.pool.Exec(ctx, `UPDATE identity_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, hashSession(token))
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

type sessionExecutor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func (store *identityStore) createSessionForAccount(ctx context.Context, executor sessionExecutor, owner account) (authResponse, error) {
	secret := make([]byte, sessionTokenBytes)
	if _, err := rand.Read(secret); err != nil {
		return authResponse{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(secret)
	sessionID, err := newUUID()
	if err != nil {
		return authResponse{}, err
	}
	createdAt := time.Now().UTC()
	expiresAt := createdAt.Add(store.sessionTTL)
	absoluteExpiresAt := createdAt.Add(sessionAbsoluteTTL)
	_, err = executor.Exec(ctx, `INSERT INTO identity_sessions (id, account_id, token_hash, expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $5)`, sessionID, owner.ID, hashSession(token), expiresAt, absoluteExpiresAt)
	if err != nil {
		return authResponse{}, err
	}
	return authResponse{Account: owner, SessionToken: token, ExpiresAt: expiresAt}, nil
}

func normalizeEmail(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" || len(value) > 254 {
		return "", errors.New("invalid email")
	}
	parsed, err := mail.ParseAddress(value)
	if err != nil || parsed.Address != value || strings.ContainsAny(value, "\r\n") {
		return "", errors.New("invalid email")
	}
	return value, nil
}

func validPassword(value string) bool {
	return utf8.ValidString(value) && utf8.RuneCountInString(value) >= 12 && len(value) <= 1024
}

func bearerToken(value string) string {
	const prefix = "Bearer "
	if len(value) <= len(prefix) || !strings.EqualFold(value[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(value[len(prefix):])
}

func hashSession(token string) []byte {
	hash := sha256.Sum256([]byte(token))
	return hash[:]
}

func newUUID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes)
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32], nil
}

func isUniqueViolation(err error) bool {
	type sqlState interface{ SQLState() string }
	var state sqlState
	return errors.As(err, &state) && state.SQLState() == "23505"
}

func (store *identityStore) consumeLoginAttempt(ctx context.Context, email string) (int, error) {
	var retryAfterSeconds int
	err := store.pool.QueryRow(ctx, `
		INSERT INTO identity_login_attempts (email_key_hash, window_started_at, attempt_count, updated_at)
		VALUES ($1, now(), 1, now())
		ON CONFLICT (email_key_hash) DO UPDATE SET
			window_started_at = CASE
				WHEN identity_login_attempts.window_started_at <= now() - interval '10 minutes' THEN now()
				ELSE identity_login_attempts.window_started_at
			END,
			attempt_count = CASE
				WHEN identity_login_attempts.blocked_until > now() THEN identity_login_attempts.attempt_count
				WHEN identity_login_attempts.window_started_at <= now() - interval '10 minutes' THEN 1
				ELSE identity_login_attempts.attempt_count + 1
			END,
			blocked_until = CASE
				WHEN identity_login_attempts.blocked_until > now() THEN identity_login_attempts.blocked_until
				WHEN identity_login_attempts.window_started_at <= now() - interval '10 minutes' THEN NULL
				WHEN identity_login_attempts.attempt_count + 1 > 5 THEN now() + interval '10 minutes'
				ELSE NULL
			END,
			updated_at = now()
		RETURNING GREATEST(0, CEIL(EXTRACT(EPOCH FROM blocked_until - now())))::integer`, store.loginAttemptKey(email)).Scan(&retryAfterSeconds)
	if err != nil {
		return 0, err
	}
	return retryAfterSeconds, nil
}

func (store *identityStore) clearLoginAttempts(ctx context.Context, email string) error {
	_, err := store.pool.Exec(ctx, `DELETE FROM identity_login_attempts WHERE email_key_hash = $1`, store.loginAttemptKey(email))
	return err
}

func (store *identityStore) loginAttemptKey(email string) []byte {
	mac := hmac.New(sha256.New, store.bffSecret)
	_, _ = mac.Write([]byte("the-estimator:identity-login-rate:v1\x00" + email))
	return mac.Sum(nil)
}

func (store *identityStore) pruneLoginAttempts(ctx context.Context) error {
	_, err := store.pool.Exec(ctx, `DELETE FROM identity_login_attempts WHERE updated_at < now() - interval '24 hours'`)
	return err
}
