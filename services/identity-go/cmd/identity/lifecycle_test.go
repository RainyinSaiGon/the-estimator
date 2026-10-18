package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

type capturedEmail struct {
	recipient string
	subject   string
	body      string
}

type captureEmailSender struct {
	messages chan capturedEmail
}

func (sender *captureEmailSender) Send(_ context.Context, recipient, subject, body string) error {
	sender.messages <- capturedEmail{recipient: recipient, subject: subject, body: body}
	return nil
}

func TestLifecycleTokenValidation(t *testing.T) {
	valid := base64.RawURLEncoding.EncodeToString(make([]byte, sessionTokenBytes))
	if !validLifecycleToken(valid) {
		t.Fatal("expected canonical 32-byte token to be valid")
	}
	for _, value := range []string{"", valid + "=", "invalid+token", strings.Repeat("a", 42), strings.Repeat("a", 44)} {
		if validLifecycleToken(value) {
			t.Fatalf("expected token %q to be rejected", value)
		}
	}
}

func TestIdentityRequestLogsExcludeCredentialsAndTokens(t *testing.T) {
	var logs bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previousLogger) })
	request := httptest.NewRequest(http.MethodPost, "/v1/password-recovery-requests?token=query-secret", strings.NewReader(`{"email":"person@example.test","password":"password-secret","token":"body-secret"}`))
	response := httptest.NewRecorder()
	requestLogging(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusAccepted, map[string]string{"message": "accepted"})
	})).ServeHTTP(response, request)
	for _, secret := range []string{"query-secret", "person@example.test", "password-secret", "body-secret"} {
		if strings.Contains(logs.String(), secret) {
			t.Errorf("request logs contain sensitive value %q: %s", secret, logs.String())
		}
	}
}

func TestIdentityLifecycleIntegration(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("IDENTITY_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set IDENTITY_TEST_DATABASE_URL to a disposable PostgreSQL database to run identity lifecycle integration checks")
	}
	t.Setenv("IDENTITY_DATABASE_URL", databaseURL)
	t.Setenv("IDENTITY_BFF_SHARED_SECRET", "test-identity-bff-secret-0123456789-abcdef")
	t.Setenv("IDENTITY_EMAIL_MODE", "disabled")
	t.Setenv("IDENTITY_PUBLIC_BASE_URL", "http://localhost:3000")
	store, err := openIdentityStore(migrationFiles)
	if err != nil {
		t.Fatalf("openIdentityStore() error = %v", err)
	}
	t.Cleanup(store.close)
	sender := &captureEmailSender{messages: make(chan capturedEmail, 8)}
	store.emailMode = "smtp"
	store.emailSender = sender
	store.publicBaseURL = "http://localhost:3000"

	verifiedEmail := testEmail(t)
	account := registerTestIdentity(t, store, verifiedEmail)
	if account.EmailVerified {
		t.Fatal("new account must not start with a verified email")
	}
	t.Cleanup(func() {
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM identity_accounts WHERE id = $1`, account.ID)
	})

	legacySession, err := store.createSessionForAccount(context.Background(), store.pool, account)
	if err != nil {
		t.Fatalf("create legacy unverified session fixture: %v", err)
	}
	lifecycleMigration, err := migrationFiles.ReadFile("migrations/002_email_lifecycle.sql")
	if err != nil {
		t.Fatalf("read email lifecycle migration: %v", err)
	}
	if _, err := store.pool.Exec(context.Background(), string(lifecycleMigration)); err != nil {
		t.Fatalf("apply email lifecycle migration to legacy session fixture: %v", err)
	}
	var legacyRevoked bool
	if err := store.pool.QueryRow(context.Background(), `SELECT revoked_at IS NOT NULL FROM identity_sessions WHERE token_hash = $1`, hashSession(legacySession.SessionToken)).Scan(&legacyRevoked); err != nil {
		t.Fatalf("read legacy session revocation: %v", err)
	}
	if !legacyRevoked {
		t.Fatal("email-verification migration must revoke existing sessions for unverified accounts")
	}
	if _, err := store.pool.Exec(context.Background(), `UPDATE identity_sessions SET revoked_at = NULL WHERE token_hash = $1`, hashSession(legacySession.SessionToken)); err != nil {
		t.Fatalf("restore legacy session fixture for endpoint checks: %v", err)
	}
	legacyCurrent := callIdentityHandler(store.currentSession, http.MethodGet, "/v1/session", "", legacySession.SessionToken, "")
	legacyRenewal := callIdentityHandler(store.renewSession, http.MethodPost, "/v1/session/renew", "", legacySession.SessionToken, "")
	if legacyCurrent.Code != http.StatusUnauthorized || legacyRenewal.Code != http.StatusUnauthorized {
		t.Fatalf("unverified legacy session access was accepted: current=%d renewal=%d", legacyCurrent.Code, legacyRenewal.Code)
	}

	var passwordSet bool
	if err := store.pool.QueryRow(context.Background(), `SELECT password_set FROM identity_accounts WHERE id = $1`, account.ID).Scan(&passwordSet); err != nil {
		t.Fatalf("read pending password state: %v", err)
	}
	if passwordSet {
		t.Fatal("new accounts must not have a usable password before email verification")
	}
	preVerificationLogin := callIdentityHandler(store.createSession, http.MethodPost, "/v1/sessions", `{"email":"`+verifiedEmail+`","password":"AttackerChosenPassword123!"}`, "", "")
	if preVerificationLogin.Code != http.StatusUnauthorized {
		t.Fatalf("pre-verification sign-in status = %d, want 401", preVerificationLogin.Code)
	}
	verificationEmail := receiveCapturedEmail(t, sender)
	verificationToken := tokenFromMail(t, verificationEmail.body)
	var storedHash []byte
	if err := store.pool.QueryRow(context.Background(), `SELECT token_hash FROM identity_lifecycle_tokens WHERE purpose = $1`, verificationPurpose).Scan(&storedHash); err != nil {
		t.Fatalf("read stored verification hash: %v", err)
	}
	if string(storedHash) == verificationToken || len(storedHash) != 32 {
		t.Fatal("verification token must be stored only as a SHA-256 digest")
	}

	completeVerification := `{"token":"` + verificationToken + `","newPassword":"InitialPassword123!"}`
	completeResponse := callIdentityHandler(store.completeEmailVerification, http.MethodPost, "/v1/email-verifications/complete", completeVerification, "", "complete-key-one")
	if completeResponse.Code != http.StatusOK {
		t.Fatalf("complete verification status = %d, body = %s", completeResponse.Code, completeResponse.Body.String())
	}
	var verifiedAuth authResponse
	if err := json.Unmarshal(completeResponse.Body.Bytes(), &verifiedAuth); err != nil {
		t.Fatalf("decode verified session: %v", err)
	}
	if verifiedAuth.SessionToken == "" || !verifiedAuth.Account.EmailVerified {
		t.Fatal("verification must set the mailbox owner's password and create a verified session")
	}
	replayResponse := callIdentityHandler(store.completeEmailVerification, http.MethodPost, "/v1/email-verifications/complete", completeVerification, "", "complete-key-two")
	if replayResponse.Code != http.StatusBadRequest {
		t.Fatalf("verification replay status = %d, want 400", replayResponse.Code)
	}
	attackerLogin := callIdentityHandler(store.createSession, http.MethodPost, "/v1/sessions", `{"email":"`+verifiedEmail+`","password":"AttackerChosenPassword123!"}`, "", "")
	if attackerLogin.Code != http.StatusUnauthorized {
		t.Fatalf("sign-in with a pre-verification password status = %d, want 401", attackerLogin.Code)
	}
	verifiedSession := callIdentityHandler(store.currentSession, http.MethodGet, "/v1/session", "", verifiedAuth.SessionToken, "")
	if verifiedSession.Code != http.StatusOK || !strings.Contains(verifiedSession.Body.String(), `"emailVerified":true`) {
		t.Fatalf("verified session response = %d %s", verifiedSession.Code, verifiedSession.Body.String())
	}
	existingRegistration := callIdentityHandler(store.registerAccount, http.MethodPost, "/v1/accounts", `{"email":"`+verifiedEmail+`","displayName":"Lifecycle Test"}`, "", "existing-registration")
	newEmail := testEmail(t)
	newRegistration := callIdentityHandler(store.registerAccount, http.MethodPost, "/v1/accounts", `{"email":"`+newEmail+`","displayName":"Lifecycle Test"}`, "", "new-registration")
	if existingRegistration.Code != http.StatusAccepted || newRegistration.Code != existingRegistration.Code || newRegistration.Body.String() != existingRegistration.Body.String() {
		t.Fatalf("existing and new registration responses differ: existing=%d %s new=%d %s", existingRegistration.Code, existingRegistration.Body.String(), newRegistration.Code, newRegistration.Body.String())
	}
	t.Cleanup(func() {
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM identity_accounts WHERE email_normalized = $1`, newEmail)
	})
	_ = receiveCapturedEmail(t, sender)

	recoveryRequest := callIdentityHandler(store.requestPasswordRecovery, http.MethodPost, "/v1/password-recovery-requests", `{"email":"`+verifiedEmail+`"}`, "", "race-request-key")
	if recoveryRequest.Code != http.StatusAccepted {
		t.Fatalf("race recovery request status = %d", recoveryRequest.Code)
	}
	raceRecoveryEmail := receiveCapturedEmail(t, sender)
	raceRecoveryToken := tokenFromMail(t, raceRecoveryEmail.body)

	resetTx, err := store.pool.Begin(context.Background())
	if err != nil {
		t.Fatalf("begin coordinated reset transaction: %v", err)
	}
	var lockedAccountID string
	if err := resetTx.QueryRow(context.Background(), `SELECT id::text FROM identity_accounts WHERE id = $1 FOR UPDATE`, account.ID).Scan(&lockedAccountID); err != nil {
		_ = resetTx.Rollback(context.Background())
		t.Fatalf("lock account for coordinated reset: %v", err)
	}
	signInResult := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		signInResult <- callIdentityHandler(store.createSession, http.MethodPost, "/v1/sessions", `{"email":"`+verifiedEmail+`","password":"InitialPassword123!"}`, "", "")
	}()
	waitForIdentitySignInLock(t, store)
	recoveryResult := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		body := `{"token":"` + raceRecoveryToken + `","newPassword":"ConcurrentResetPassword456!"}`
		recoveryResult <- callIdentityHandler(store.completePasswordRecovery, http.MethodPost, "/v1/password-recoveries", body, "", "race-complete-key")
	}()
	waitForIdentityRecoveryLock(t, store)
	if err := resetTx.Commit(context.Background()); err != nil {
		t.Fatalf("release coordinated sign-in/recovery lock: %v", err)
	}
	var staleSignIn *httptest.ResponseRecorder
	select {
	case staleSignIn = <-signInResult:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for sign-in blocked by password reset")
	}
	var concurrentRecovery *httptest.ResponseRecorder
	select {
	case concurrentRecovery = <-recoveryResult:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for password recovery blocked by sign-in")
	}
	if concurrentRecovery.Code != http.StatusNoContent {
		t.Fatalf("concurrent password recovery status = %d, want 204: %s", concurrentRecovery.Code, concurrentRecovery.Body.String())
	}
	if staleSignIn.Code != http.StatusUnauthorized && staleSignIn.Code != http.StatusCreated {
		t.Fatalf("concurrent sign-in status = %d, want 401 or 201 depending on lock order: %s", staleSignIn.Code, staleSignIn.Body.String())
	}
	if staleSignIn.Code == http.StatusCreated {
		var racedAuth authResponse
		if err := json.Unmarshal(staleSignIn.Body.Bytes(), &racedAuth); err != nil {
			t.Fatalf("decode raced sign-in session: %v", err)
		}
		if racedAuth.SessionToken == "" {
			t.Fatal("raced sign-in did not return its session token")
		}
		staleSession := callIdentityHandler(store.currentSession, http.MethodGet, "/v1/session", "", racedAuth.SessionToken, "")
		if staleSession.Code != http.StatusUnauthorized {
			t.Fatalf("session created before recovery remained valid: status=%d", staleSession.Code)
		}
	}
	loginAfterReset := callIdentityHandler(store.createSession, http.MethodPost, "/v1/sessions", `{"email":"`+verifiedEmail+`","password":"ConcurrentResetPassword456!"}`, "", "")
	if loginAfterReset.Code != http.StatusCreated {
		t.Fatalf("sign-in with concurrent reset password status = %d, want 201: %s", loginAfterReset.Code, loginAfterReset.Body.String())
	}
	var postRaceAuth authResponse
	if err := json.Unmarshal(loginAfterReset.Body.Bytes(), &postRaceAuth); err != nil {
		t.Fatalf("decode post-race session: %v", err)
	}

	recoveryBody := `{"email":"` + verifiedEmail + `"}`
	recoveryResponse := callIdentityHandler(store.requestPasswordRecovery, http.MethodPost, "/v1/password-recovery-requests", recoveryBody, "", "request-key-two")
	unknownResponse := callIdentityHandler(store.requestPasswordRecovery, http.MethodPost, "/v1/password-recovery-requests", `{"email":"missing-`+strings.TrimPrefix(verifiedEmail, "test-")+`"}`, "", "request-key-two")
	if recoveryResponse.Code != http.StatusAccepted || unknownResponse.Code != recoveryResponse.Code || unknownResponse.Body.String() != recoveryResponse.Body.String() {
		t.Fatalf("known and unknown recovery responses differ: known=%d %s unknown=%d %s", recoveryResponse.Code, recoveryResponse.Body.String(), unknownResponse.Code, unknownResponse.Body.String())
	}
	store.emailMode = "disabled"
	unverifiedEmail := testEmail(t)
	unverifiedAccount := registerTestIdentity(t, store, unverifiedEmail)
	t.Cleanup(func() {
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM identity_accounts WHERE id = $1`, unverifiedAccount.ID)
	})
	store.emailMode = "smtp"
	unverifiedResponse := callIdentityHandler(store.requestPasswordRecovery, http.MethodPost, "/v1/password-recovery-requests", `{"email":"`+unverifiedEmail+`"}`, "", "request-key-two")
	if unverifiedResponse.Code != unknownResponse.Code || unverifiedResponse.Body.String() != unknownResponse.Body.String() {
		t.Fatalf("unverified and unknown recovery responses differ: unverified=%d %s unknown=%d %s", unverifiedResponse.Code, unverifiedResponse.Body.String(), unknownResponse.Code, unknownResponse.Body.String())
	}
	store.emailMode = "disabled"
	disabledKnown := callIdentityHandler(store.requestPasswordRecovery, http.MethodPost, "/v1/password-recovery-requests", recoveryBody, "", "disabled-key")
	disabledUnknown := callIdentityHandler(store.requestPasswordRecovery, http.MethodPost, "/v1/password-recovery-requests", `{"email":"nobody@example.test"}`, "", "disabled-key")
	store.emailMode = "smtp"
	if disabledKnown.Code != http.StatusServiceUnavailable || disabledUnknown.Code != disabledKnown.Code || disabledUnknown.Body.String() != disabledKnown.Body.String() {
		t.Fatalf("delivery-disabled recovery responses differ: known=%d %s unknown=%d %s", disabledKnown.Code, disabledKnown.Body.String(), disabledUnknown.Code, disabledUnknown.Body.String())
	}
	recoveryEmail := receiveCapturedEmail(t, sender)
	recoveryToken := tokenFromMail(t, recoveryEmail.body)

	if _, err := store.pool.Exec(context.Background(), `UPDATE identity_lifecycle_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = $1`, hashLifecycleToken(recoveryToken)); err != nil {
		t.Fatalf("expire recovery token: %v", err)
	}
	expiredResponse := callIdentityHandler(store.completePasswordRecovery, http.MethodPost, "/v1/password-recoveries", `{"token":"`+recoveryToken+`","newPassword":"ReplacementPassword456!"}`, "", "complete-key-three")
	if expiredResponse.Code != http.StatusBadRequest {
		t.Fatalf("expired recovery status = %d, want 400", expiredResponse.Code)
	}

	secondRecovery := callIdentityHandler(store.requestPasswordRecovery, http.MethodPost, "/v1/password-recovery-requests", recoveryBody, "", "request-key-three")
	if secondRecovery.Code != http.StatusAccepted {
		t.Fatalf("second recovery request status = %d", secondRecovery.Code)
	}
	secondRecoveryEmail := receiveCapturedEmail(t, sender)
	secondRecoveryToken := tokenFromMail(t, secondRecoveryEmail.body)
	resetBody := `{"token":"` + secondRecoveryToken + `","newPassword":"ReplacementPassword456!"}`
	resetResponse := callIdentityHandler(store.completePasswordRecovery, http.MethodPost, "/v1/password-recoveries", resetBody, "", "complete-key-four")
	if resetResponse.Code != http.StatusNoContent {
		t.Fatalf("password reset status = %d, body = %s", resetResponse.Code, resetResponse.Body.String())
	}
	oldSession := callIdentityHandler(store.currentSession, http.MethodGet, "/v1/session", "", postRaceAuth.SessionToken, "")
	if oldSession.Code != http.StatusUnauthorized {
		t.Fatalf("pre-reset session status = %d, want 401", oldSession.Code)
	}
	resetReplay := callIdentityHandler(store.completePasswordRecovery, http.MethodPost, "/v1/password-recoveries", resetBody, "", "complete-key-five")
	if resetReplay.Code != http.StatusBadRequest {
		t.Fatalf("recovery replay status = %d, want 400", resetReplay.Code)
	}
	loginResponse := callIdentityHandler(store.createSession, http.MethodPost, "/v1/sessions", `{"email":"`+verifiedEmail+`","password":"ReplacementPassword456!"}`, "", "")
	if loginResponse.Code != http.StatusCreated || !strings.Contains(loginResponse.Body.String(), `"emailVerified":true`) {
		t.Fatalf("sign in with reset password response = %d %s", loginResponse.Code, loginResponse.Body.String())
	}

	unknownEmail := testEmail(t)
	for attempt := 1; attempt <= 4; attempt++ {
		response := callIdentityHandler(store.requestPasswordRecovery, http.MethodPost, "/v1/password-recovery-requests", `{"email":"`+unknownEmail+`"}`, "", "throttle-key")
		want := http.StatusAccepted
		if attempt == 4 {
			want = http.StatusTooManyRequests
		}
		if response.Code != want {
			t.Fatalf("recovery throttle attempt %d status = %d, want %d", attempt, response.Code, want)
		}
	}
}

func registerTestIdentity(t *testing.T, store *identityStore, email string) account {
	t.Helper()
	body := `{"email":"` + email + `","displayName":"Lifecycle Test"}`
	response := callIdentityHandler(store.registerAccount, http.MethodPost, "/v1/accounts", body, "", "register-key")
	if response.Code != http.StatusAccepted {
		t.Fatalf("register status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		VerificationRequired bool     `json:"verificationRequired"`
		SessionToken         string   `json:"sessionToken"`
		Account              *account `json:"account"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.VerificationRequired || payload.SessionToken != "" || payload.Account != nil {
		t.Fatal("registration must return a generic verification response without creating a session")
	}
	var created account
	if err := store.pool.QueryRow(context.Background(), `SELECT id::text, email_normalized, display_name, email_verified FROM identity_accounts WHERE email_normalized = $1`, email).Scan(&created.ID, &created.Email, &created.DisplayName, &created.EmailVerified); err != nil {
		t.Fatalf("read newly registered account: %v", err)
	}
	return created
}

func waitForIdentitySignInLock(t *testing.T, store *identityStore) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		var waiting bool
		if err := store.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND query LIKE '%identity_signin_lock%' AND wait_event_type = 'Lock')`).Scan(&waiting); err != nil {
			t.Fatalf("observe sign-in lock wait: %v", err)
		}
		if waiting {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("sign-in did not wait on the account row lock")
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func waitForIdentityRecoveryLock(t *testing.T, store *identityStore) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		var waiting bool
		if err := store.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND query LIKE '%identity_recovery_lock%' AND wait_event_type = 'Lock')`).Scan(&waiting); err != nil {
			t.Fatalf("observe recovery lock wait: %v", err)
		}
		if waiting {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("password recovery did not wait on the account row lock")
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func callIdentityHandler(handler http.HandlerFunc, method, path, body, sessionToken, requestRateKey string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("content-type", "application/json")
	if sessionToken != "" {
		request.Header.Set("authorization", "Bearer "+sessionToken)
	}
	if requestRateKey != "" {
		request.Header.Set("x-identity-rate-key", base64.RawURLEncoding.EncodeToString([]byte(requestRateKey)))
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func receiveCapturedEmail(t *testing.T, sender *captureEmailSender) capturedEmail {
	t.Helper()
	select {
	case message := <-sender.messages:
		return message
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for lifecycle email")
		return capturedEmail{}
	}
}

func tokenFromMail(t *testing.T, body string) string {
	t.Helper()
	index := strings.LastIndex(body, "token=")
	if index < 0 {
		t.Fatal("email body did not contain a token link")
	}
	token := strings.Fields(body[index+len("token="):])[0]
	if !validLifecycleToken(token) {
		t.Fatalf("email contained invalid lifecycle token %q", token)
	}
	return token
}

func testEmail(t *testing.T) string {
	t.Helper()
	id, err := newUUID()
	if err != nil {
		t.Fatal(err)
	}
	return "test-" + strings.ReplaceAll(id, "-", "") + "@example.test"
}
