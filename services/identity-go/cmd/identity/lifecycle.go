package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/argon2"
)

type lifecycleTokenRequest struct {
	Token string `json:"token"`
}

type completeEmailVerificationRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"newPassword"`
}

type recoveryRequest struct {
	Email string `json:"email"`
}

type completeRecoveryRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"newPassword"`
}

func (store *identityStore) requestEmailVerification(w http.ResponseWriter, r *http.Request) {
	if store.emailMode != "smtp" || store.emailSender == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Email delivery is unavailable."})
		return
	}
	token := bearerToken(r.Header.Get("authorization"))
	if token == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Sign in to continue."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	var owner account
	err := store.pool.QueryRow(ctx, `SELECT a.id::text, a.email_normalized, a.display_name, a.email_verified FROM identity_sessions s JOIN identity_accounts a ON a.id = s.account_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, hashSession(token)).Scan(&owner.ID, &owner.Email, &owner.DisplayName, &owner.EmailVerified)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Sign in to continue."})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	retryAfter, err := store.consumeLifecycleAttempt(ctx, "verification_request", owner.ID, 3, 15*time.Minute, 15*time.Minute)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if retryAfter > 0 {
		w.Header().Set("retry-after", strconv.Itoa(retryAfter))
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Verification requests are temporarily limited."})
		return
	}
	retryAfter, err = store.consumeLifecycleAttempt(ctx, "verification_network", requestRateKey(r), 10, 15*time.Minute, 15*time.Minute)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if retryAfter > 0 {
		w.Header().Set("retry-after", strconv.Itoa(retryAfter))
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Verification requests are temporarily limited."})
		return
	}
	if !owner.EmailVerified {
		if err := store.issueLifecycleToken(ctx, owner, verificationPurpose); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Email delivery is unavailable."})
			return
		}
	}
	w.WriteHeader(http.StatusAccepted)
}

func (store *identityStore) completeEmailVerification(w http.ResponseWriter, r *http.Request) {
	var input completeEmailVerificationRequest
	if !decodeJSON(w, r, &input) || !validLifecycleToken(input.Token) || !validPassword(input.NewPassword) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The verification link is invalid or expired."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	retryAfter, err := store.consumeLifecycleAttempt(ctx, "verification_complete", input.Token, 10, 15*time.Minute, 15*time.Minute)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if retryAfter > 0 {
		w.Header().Set("retry-after", strconv.Itoa(retryAfter))
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Verification attempts are temporarily limited."})
		return
	}
	retryAfter, err = store.consumeLifecycleAttempt(ctx, "verification_complete", "network:"+requestRateKey(r), 30, 15*time.Minute, 15*time.Minute)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if retryAfter > 0 {
		w.Header().Set("retry-after", strconv.Itoa(retryAfter))
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Verification attempts are temporarily limited."})
		return
	}
	salt := make([]byte, argonSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The account could not be verified."})
		return
	}
	hash := argon2.IDKey([]byte(input.NewPassword), salt, argonIterations, argonMemoryKiB, argonParallelism, argonKeyBytes)
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	var owner account
	err = tx.QueryRow(ctx, `SELECT a.id::text, a.email_normalized, a.display_name FROM identity_lifecycle_tokens t JOIN identity_accounts a ON a.id = t.account_id WHERE t.token_hash = $1 AND t.purpose = $2 AND t.consumed_at IS NULL AND t.expires_at > now() AND a.email_verified = FALSE FOR UPDATE OF t, a`, hashLifecycleToken(input.Token), verificationPurpose).Scan(&owner.ID, &owner.Email, &owner.DisplayName)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The verification link is invalid or expired."})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE identity_accounts SET email_verified = TRUE, password_set = TRUE, password_salt = $1, password_hash = $2 WHERE id = $3 AND email_verified = FALSE`, salt, hash, owner.ID); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE identity_lifecycle_tokens SET consumed_at = now() WHERE account_id = $1 AND purpose = $2 AND consumed_at IS NULL`, owner.ID, verificationPurpose); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE identity_sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL`, owner.ID); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	owner.EmailVerified = true
	response, err := store.createSessionForAccount(ctx, tx, owner)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "A sign-in session could not be created."})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (store *identityStore) requestPasswordRecovery(w http.ResponseWriter, r *http.Request) {
	if store.emailMode != "smtp" || store.emailSender == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Email delivery is unavailable."})
		return
	}
	var input recoveryRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	email, err := normalizeEmail(input.Email)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Provide a valid email address."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	retryAfter, err := store.consumeLifecycleAttempt(ctx, "recovery_request", email, 3, 15*time.Minute, 15*time.Minute)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if retryAfter > 0 {
		w.Header().Set("retry-after", strconv.Itoa(retryAfter))
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Recovery requests are temporarily limited."})
		return
	}
	retryAfter, err = store.consumeLifecycleAttempt(ctx, "recovery_network", requestRateKey(r), 10, 15*time.Minute, 15*time.Minute)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if retryAfter > 0 {
		w.Header().Set("retry-after", strconv.Itoa(retryAfter))
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Recovery requests are temporarily limited."})
		return
	}
	var owner account
	err = store.pool.QueryRow(ctx, `SELECT id::text, email_normalized, display_name, email_verified FROM identity_accounts WHERE email_normalized = $1`, email).Scan(&owner.ID, &owner.Email, &owner.DisplayName, &owner.EmailVerified)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && !owner.EmailVerified {
		writeJSON(w, http.StatusAccepted, map[string]string{"message": "If an eligible account exists, recovery instructions will be sent."})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if err := store.issueLifecycleToken(ctx, owner, recoveryPurpose); err != nil {
		// Keep account state and delivery failures indistinguishable to the caller.
		slog.Warn("identity_recovery_email_queued_failed", "service", "identity-go", "reason", "delivery_unavailable")
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"message": "If an eligible account exists, recovery instructions will be sent."})
}

func (store *identityStore) completePasswordRecovery(w http.ResponseWriter, r *http.Request) {
	var input completeRecoveryRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !validLifecycleToken(input.Token) || !validPassword(input.NewPassword) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The recovery link or new password is invalid."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	retryAfter, err := store.consumeLifecycleAttempt(ctx, "recovery_complete", input.Token, 10, 15*time.Minute, 15*time.Minute)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if retryAfter > 0 {
		w.Header().Set("retry-after", strconv.Itoa(retryAfter))
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Recovery attempts are temporarily limited."})
		return
	}
	retryAfter, err = store.consumeLifecycleAttempt(ctx, "recovery_complete", "network:"+requestRateKey(r), 30, 15*time.Minute, 15*time.Minute)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if retryAfter > 0 {
		w.Header().Set("retry-after", strconv.Itoa(retryAfter))
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Recovery attempts are temporarily limited."})
		return
	}
	salt := make([]byte, argonSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The password could not be reset."})
		return
	}
	hash := argon2.IDKey([]byte(input.NewPassword), salt, argonIterations, argonMemoryKiB, argonParallelism, argonKeyBytes)
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	var accountID, email string
	err = tx.QueryRow(ctx, `/* identity_recovery_lock */ SELECT t.account_id::text, a.email_normalized FROM identity_lifecycle_tokens t JOIN identity_accounts a ON a.id = t.account_id WHERE t.token_hash = $1 AND t.purpose = $2 AND t.consumed_at IS NULL AND t.expires_at > now() AND a.email_verified = TRUE FOR UPDATE OF t, a`, hashLifecycleToken(input.Token), recoveryPurpose).Scan(&accountID, &email)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The recovery link is invalid or expired."})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE identity_accounts SET password_salt = $1, password_hash = $2 WHERE id = $3 AND email_verified = TRUE`, salt, hash, accountID); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE identity_lifecycle_tokens SET consumed_at = now() WHERE account_id = $1 AND purpose = $2 AND consumed_at IS NULL`, accountID, recoveryPurpose); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE identity_sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL`, accountID); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if _, err := tx.Exec(ctx, `DELETE FROM identity_login_attempts WHERE email_key_hash = $1`, store.loginAttemptKey(email)); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Identity storage is temporarily unavailable."})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (store *identityStore) issueLifecycleToken(ctx context.Context, owner account, purpose string) error {
	if store.emailMode != "smtp" || store.emailSender == nil || !owner.EmailVerified && purpose == recoveryPurpose {
		return errors.New("email delivery is unavailable")
	}
	tokenBytes := make([]byte, sessionTokenBytes)
	if _, err := rand.Read(tokenBytes); err != nil {
		return err
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	var ttl time.Duration
	switch purpose {
	case verificationPurpose:
		ttl = verificationTokenTTL
	case recoveryPurpose:
		ttl = recoveryTokenTTL
	default:
		return errors.New("unknown lifecycle token purpose")
	}
	_, err := store.pool.Exec(ctx, `INSERT INTO identity_lifecycle_tokens (token_hash, account_id, purpose, expires_at) VALUES ($1, $2, $3, $4)`, hashLifecycleToken(token), owner.ID, purpose, time.Now().UTC().Add(ttl))
	if err != nil {
		return err
	}
	path := "/verify-email#token="
	subject := "Verify your Estimator account"
	if purpose == recoveryPurpose {
		path = "/password-recovery#token="
		subject = "Reset your Estimator password"
	}
	link := store.publicBaseURL + path + token
	body := "Use this one-time link to continue: " + link + "\n\nIf you did not request this message, you can ignore it."
	go func(token string, tokenHash []byte, recipient, subject, body string) {
		deliveryContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if sendErr := store.emailSender.Send(deliveryContext, recipient, subject, body); sendErr != nil {
			cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cleanupCancel()
			_, _ = store.pool.Exec(cleanupContext, `UPDATE identity_lifecycle_tokens SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL`, tokenHash)
			slog.Warn("identity_email_delivery_failed", "service", "identity-go", "purpose", purpose, "reason", "smtp_unavailable")
		}
	}(token, hashLifecycleToken(token), owner.Email, subject, body)
	return nil
}

func (store *identityStore) consumeLifecycleAttempt(ctx context.Context, purpose, key string, limit int, window, block time.Duration) (int, error) {
	var retryAfter int
	err := store.pool.QueryRow(ctx, `
		INSERT INTO identity_lifecycle_attempts (key_hash, purpose, window_started_at, attempt_count, updated_at)
		VALUES ($1, $2, now(), 1, now())
		ON CONFLICT (key_hash, purpose) DO UPDATE SET
			window_started_at = CASE
				WHEN identity_lifecycle_attempts.blocked_until > now() THEN identity_lifecycle_attempts.window_started_at
				WHEN identity_lifecycle_attempts.window_started_at <= now() - ($3 * interval '1 second') THEN now()
				ELSE identity_lifecycle_attempts.window_started_at
			END,
			attempt_count = CASE
				WHEN identity_lifecycle_attempts.blocked_until > now() THEN identity_lifecycle_attempts.attempt_count
				WHEN identity_lifecycle_attempts.window_started_at <= now() - ($3 * interval '1 second') THEN 1
				ELSE identity_lifecycle_attempts.attempt_count + 1
			END,
			blocked_until = CASE
				WHEN identity_lifecycle_attempts.blocked_until > now() THEN identity_lifecycle_attempts.blocked_until
				WHEN identity_lifecycle_attempts.window_started_at <= now() - ($3 * interval '1 second') THEN NULL
				WHEN identity_lifecycle_attempts.attempt_count + 1 > $4 THEN now() + ($5 * interval '1 second')
				ELSE NULL
			END,
			updated_at = now()
		RETURNING GREATEST(0, CEIL(EXTRACT(EPOCH FROM blocked_until - now())))::integer`, store.lifecycleAttemptKey(purpose, key), purpose, int(window.Seconds()), limit, int(block.Seconds())).Scan(&retryAfter)
	return retryAfter, err
}

func (store *identityStore) lifecycleAttemptKey(purpose, key string) []byte {
	mac := hmac.New(sha256.New, store.bffSecret)
	_, _ = mac.Write([]byte("the-estimator:identity-lifecycle:v1\x00" + purpose + "\x00" + key))
	return mac.Sum(nil)
}

func requestRateKey(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("x-identity-rate-key"))
	if validLifecycleToken(value) {
		return value
	}
	return "unknown-network"
}

func (store *identityStore) pruneLifecycleData(ctx context.Context) error {
	if _, err := store.pool.Exec(ctx, `DELETE FROM identity_lifecycle_tokens WHERE expires_at < now() - interval '7 days' OR consumed_at < now() - interval '7 days'`); err != nil {
		return err
	}
	_, err := store.pool.Exec(ctx, `DELETE FROM identity_lifecycle_attempts WHERE updated_at < now() - interval '24 hours'`)
	return err
}

func validLifecycleToken(value string) bool {
	if len(value) != 43 || strings.ContainsAny(value, "=+/") {
		return false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(decoded) == sessionTokenBytes && base64.RawURLEncoding.EncodeToString(decoded) == value
}

func hashLifecycleToken(token string) []byte {
	digest := sha256.Sum256([]byte(token))
	return digest[:]
}

func lifecycleTokenFingerprint(token string) string {
	return hex.EncodeToString(hashLifecycleToken(token))
}
