package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestVerifyServiceTokenUsesKeyIDAndOperationScope(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	activeSecret := []byte("active-service-token-key-0123456789")
	previousSecret := []byte("previous-service-token-key-012345678")
	keys := map[string][]byte{"active-2026-10": activeSecret, "previous-2026-09": previousSecret, "legacy": previousSecret}

	tests := []struct {
		name         string
		keyID        string
		includeKeyID bool
		scope        string
		audience     any
		expiration   int64
		wantErr      bool
	}{
		{name: "active key and exact scope", keyID: "active-2026-10", includeKeyID: true, scope: "private-records:read", audience: "the-estimator-go", expiration: now.Unix() + 60},
		{name: "previous key by key ID", keyID: "previous-2026-09", includeKeyID: true, scope: "private-records:read", audience: "the-estimator-go", expiration: now.Unix() + 60},
		{name: "previous legacy key without key ID", keyID: "legacy", scope: "private-records:read", audience: "the-estimator-go", expiration: now.Unix() + 60},
		{name: "unknown key ID", keyID: "missing", includeKeyID: true, scope: "private-records:read", audience: "the-estimator-go", expiration: now.Unix() + 60, wantErr: true},
		{name: "wrong scope", keyID: "active-2026-10", includeKeyID: true, scope: "private-records:delete", audience: "the-estimator-go", expiration: now.Unix() + 60, wantErr: true},
		{name: "wrong audience", keyID: "active-2026-10", includeKeyID: true, scope: "private-records:read", audience: "another-service", expiration: now.Unix() + 60, wantErr: true},
		{name: "expired token", keyID: "active-2026-10", includeKeyID: true, scope: "private-records:read", audience: "the-estimator-go", expiration: now.Unix() - 60, wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			secret := activeSecret
			if test.keyID == "previous-2026-09" || test.keyID == "legacy" {
				secret = previousSecret
			}
			token := signedRecordServiceToken(t, test.keyID, test.includeKeyID, secret, now, test.scope, test.audience, test.expiration)
			principal, err := verifyServiceToken(token, keys, "private-records:read", now)
			if test.wantErr {
				if err == nil {
					t.Fatal("expected token verification to fail")
				}
				return
			}
			if err != nil {
				t.Fatalf("verifyServiceToken() error = %v", err)
			}
			if principal.subject != "0e7f3f96-7c9a-4db6-9a8d-35fe35ac9bce" || principal.issuer != "first-party-v1" {
				t.Fatalf("unexpected principal: %#v", principal)
			}
		})
	}
}

func TestVerifyServiceTokenRejectsLegacyKeyWhenNotConfigured(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	secret := []byte("legacy-service-token-key-0123456789")
	token := signedRecordServiceToken(t, "legacy", false, secret, now, "private-records:read", "the-estimator-go", now.Unix()+60)
	if _, err := verifyServiceToken(token, map[string][]byte{"active": []byte("active-service-token-key-0123456789")}, "private-records:read", now); err == nil {
		t.Fatal("expected unconfigured legacy key to be rejected")
	}
}

func TestVerifyServiceTokenRejectsInvalidIdentityClaims(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	secret := []byte("active-service-token-key-0123456789")
	keys := map[string][]byte{"active": secret}
	tests := []struct {
		name      string
		overrides map[string]any
	}{
		{name: "wrong issuer", overrides: map[string]any{"iss": "other-service"}},
		{name: "wrong identity authority", overrides: map[string]any{"identity_authority": "oidc"}},
		{name: "missing verified-email claim", overrides: map[string]any{"email_verified": nil}},
		{name: "unverified account", overrides: map[string]any{"email_verified": false}},
		{name: "client-selected owner claim", overrides: map[string]any{"owner_id": "11111111-1111-4111-8111-111111111111"}},
		{name: "empty owner claim is still forbidden", overrides: map[string]any{"owner_id": ""}},
		{name: "extra audience", overrides: map[string]any{"aud": []string{"the-estimator-go", "another-service"}}},
		{name: "lifetime over 60 seconds", overrides: map[string]any{"exp": now.Unix() + 61}},
		{name: "future issued at", overrides: map[string]any{"iat": now.Unix() + 1}},
		{name: "missing token id", overrides: map[string]any{"jti": ""}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			token := signedRecordServiceTokenWithClaims(t, "active", true, secret, now, "private-records:read", "the-estimator-go", now.Unix()+60, test.overrides)
			if _, err := verifyServiceToken(token, keys, "private-records:read", now); err == nil {
				t.Fatal("expected invalid identity claims to be rejected")
			}
		})
	}
}

func TestConfiguredServiceTokenKeysValidatesRotationRing(t *testing.T) {
	active := "active-service-token-key-0123456789"
	previous := "previous-service-token-key-012345678"
	keys, err := configuredServiceTokenKeys("active-2026-10", active, `{"legacy":"`+previous+`"}`)
	if err != nil {
		t.Fatalf("configuredServiceTokenKeys() error = %v", err)
	}
	if string(keys["active-2026-10"]) != active || string(keys["legacy"]) != previous {
		t.Fatalf("unexpected configured key ring: %#v", keys)
	}

	invalid := []struct {
		name, keyID, secret, previous string
	}{
		{name: "missing active key ID", keyID: "", secret: active},
		{name: "invalid active key ID", keyID: "contains space", secret: active},
		{name: "short active secret", keyID: "active", secret: "short"},
		{name: "invalid key JSON", keyID: "active", secret: active, previous: "not-json"},
		{name: "short previous secret", keyID: "active", secret: active, previous: `{"old":"short"}`},
		{name: "conflicting active key", keyID: "active", secret: active, previous: `{"active":"different-service-token-key-012345678"}`},
	}
	for _, test := range invalid {
		t.Run(test.name, func(t *testing.T) {
			if _, err := configuredServiceTokenKeys(test.keyID, test.secret, test.previous); err == nil {
				t.Fatal("expected invalid key configuration to fail")
			}
		})
	}
}

func TestPrivateRecordsTwoAccountAuthorizationIntegration(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("RECORD_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set RECORD_TEST_DATABASE_URL to a disposable PostgreSQL database to run private-record isolation checks")
	}
	serviceSecret := "record-service-test-secret-0123456789-abcdef"
	contentKey := make([]byte, 32)
	identityKey := make([]byte, 32)
	for index := range contentKey {
		contentKey[index] = byte(index + 1)
		identityKey[index] = byte(255 - index)
	}
	t.Setenv("DATABASE_URL", databaseURL)
	t.Setenv("SERVICE_TOKEN_SECRET", serviceSecret)
	t.Setenv("SERVICE_TOKEN_KEY_ID", "record-test-key")
	t.Setenv("SERVICE_TOKEN_VERIFICATION_KEYS", "")
	t.Setenv("CLIENT_CONTENT_KEY", base64.StdEncoding.EncodeToString(contentKey))
	t.Setenv("IDENTITY_INDEX_KEY", base64.StdEncoding.EncodeToString(identityKey))
	t.Setenv("RECORD_RETENTION_DAYS", "90")
	store, err := openRecordStore()
	if err != nil {
		t.Fatalf("openRecordStore() error = %v", err)
	}
	ownerA, err := newUUID()
	if err != nil {
		t.Fatal(err)
	}
	ownerB, err := newUUID()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		for _, owner := range []recordPrincipal{{issuer: "first-party-v1", subject: ownerA}, {issuer: "first-party-v1", subject: ownerB}} {
			_, _ = store.pool.Exec(ctx, `DELETE FROM estimator_accounts WHERE owner_key = $1`, store.ownerLookupKey(owner))
		}
		store.close()
	})

	call := func(method, path, subject, scope, body string) *httptest.ResponseRecorder {
		now := time.Now()
		serviceToken := signedRecordServiceTokenWithClaims(
			t,
			"record-test-key",
			true,
			[]byte(serviceSecret),
			now,
			scope,
			"the-estimator-go",
			now.Unix()+60,
			map[string]any{"sub": subject},
		)
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+serviceToken)
		if strings.HasPrefix(path, "/v1/records/") {
			recordPath := strings.TrimPrefix(path, "/v1/records/")
			if separator := strings.IndexByte(recordPath, '/'); separator >= 0 {
				recordPath = recordPath[:separator]
			}
			request.SetPathValue("recordID", recordPath)
		}
		response := httptest.NewRecorder()
		if path == "/v1/records" {
			store.handleRecords(response, request)
		} else if strings.HasSuffix(path, "/delivery") {
			store.handleDelivery(response, request)
		} else if strings.HasSuffix(path, "/delivery/review") {
			store.handleDeliveryReview(response, request)
		} else {
			store.handleRecord(response, request)
		}
		return response
	}
	create := func(subject, title string) string {
		t.Helper()
		reviewText := "The client requests a CRM contact migration and nightly synchronization."
		payload, marshalErr := json.Marshal(map[string]any{
			"schemaVersion":   1,
			"title":           title,
			"source":          map[string]any{"name": "brief.txt", "type": "txt", "characters": len(reviewText), "truncated": false, "reviewText": reviewText},
			"originalFile":    nil,
			"suggestedScope":  map[string]any{"summary": "suggested"},
			"reviewedScope":   map[string]any{"requirements": []any{map[string]any{"id": "mapping", "evidence": "CRM contact migration"}}},
			"estimate":        map[string]any{"hours": 5, "low": 4, "high": 6, "tasks": []any{map[string]any{"category": "mapping"}}},
			"deliveryOutcome": nil,
		})
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		body, marshalErr := json.Marshal(map[string]any{"schemaVersion": 1, "reviewConfirmed": true, "payload": json.RawMessage(payload)})
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		response := call(http.MethodPost, "/v1/records", subject, "private-records:create", string(body))
		if response.Code != http.StatusCreated {
			t.Fatalf("create record for %s returned %d: %s", title, response.Code, response.Body.String())
		}
		var created struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil || !isUUID(created.ID) {
			t.Fatalf("create response did not include record ID: %s (%v)", response.Body.String(), err)
		}
		return created.ID
	}
	listIDs := func(subject string) []string {
		t.Helper()
		response := call(http.MethodGet, "/v1/records", subject, "private-records:read", "")
		if response.Code != http.StatusOK {
			t.Fatalf("list records returned %d: %s", response.Code, response.Body.String())
		}
		var payload struct {
			Records []recordSummary `json:"records"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		ids := make([]string, 0, len(payload.Records))
		for _, record := range payload.Records {
			ids = append(ids, record.ID)
		}
		return ids
	}
	containsID := func(ids []string, id string) bool {
		for _, candidate := range ids {
			if candidate == id {
				return true
			}
		}
		return false
	}
	assertOnlyOwn := func(subject, ownID, foreignID string) {
		t.Helper()
		ids := listIDs(subject)
		if len(ids) != 1 || !containsID(ids, ownID) || containsID(ids, foreignID) {
			t.Fatalf("account %s received unexpected record IDs: %#v", subject, ids)
		}
	}
	ownerARecord := create(ownerA, "Owner A estimate")
	ownerBRecord := create(ownerB, "Owner B estimate")
	assertOnlyOwn(ownerA, ownerARecord, ownerBRecord)
	assertOnlyOwn(ownerB, ownerBRecord, ownerARecord)

	baselineResponse := call(http.MethodGet, "/v1/records/"+ownerARecord, ownerA, "private-records:read", "")
	if baselineResponse.Code != http.StatusOK {
		t.Fatalf("get record returned %d: %s", baselineResponse.Code, baselineResponse.Body.String())
	}
	var saved struct {
		Payload recordPayload `json:"payload"`
	}
	if err := json.Unmarshal(baselineResponse.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	var baseline frozenRecordBaseline
	if err := json.Unmarshal(saved.Payload.Baseline, &baseline); err != nil {
		t.Fatal(err)
	}
	deliveryBody, _ := json.Marshal(createDeliveryRequest{BaselineID: baseline.ID, BaselineSHA256: baseline.SHA256, CompletedAt: time.Now().UTC(), ActualHours: map[string]float64{"mapping": 6}, AdditionalHours: 2, EvidenceSource: "timesheet", EvidenceReference: "timesheet-case-1"})
	if response := call(http.MethodPost, "/v1/records/"+ownerARecord+"/delivery", ownerB, "private-records:update", string(deliveryBody)); response.Code != http.StatusNotFound {
		t.Fatalf("foreign owner delivery write returned %d: %s", response.Code, response.Body.String())
	}
	deliveryResponse := call(http.MethodPost, "/v1/records/"+ownerARecord+"/delivery", ownerA, "private-records:update", string(deliveryBody))
	if deliveryResponse.Code != http.StatusCreated {
		t.Fatalf("record delivery returned %d: %s", deliveryResponse.Code, deliveryResponse.Body.String())
	}
	reviewBody := `{"decision":"approved","note":"Verified against the test timesheet."}`
	if response := call(http.MethodPatch, "/v1/records/"+ownerARecord+"/delivery/review", ownerB, "private-records:update", reviewBody); response.Code != http.StatusNotFound {
		t.Fatalf("foreign owner review returned %d: %s", response.Code, response.Body.String())
	}
	reviewResponse := call(http.MethodPatch, "/v1/records/"+ownerARecord+"/delivery/review", ownerA, "private-records:update", reviewBody)
	if reviewResponse.Code != http.StatusOK {
		t.Fatalf("delivery review returned %d: %s", reviewResponse.Code, reviewResponse.Body.String())
	}
	var reviewed struct {
		DeliveryOutcome deliveryOutcome `json:"deliveryOutcome"`
	}
	if err := json.Unmarshal(reviewResponse.Body.Bytes(), &reviewed); err != nil {
		t.Fatal(err)
	}
	if reviewed.DeliveryOutcome.ReviewStatus != "approved" || !reviewed.DeliveryOutcome.CalibrationEligible || reviewed.DeliveryOutcome.ActualHours["mapping"] != 6 || reviewed.DeliveryOutcome.AdditionalHours != 2 || len(reviewed.DeliveryOutcome.ReviewDecisions) != 1 || reviewed.DeliveryOutcome.ReviewDecisions[0].ActorID != ownerA {
		t.Fatalf("delivery review lost attribution or task-level actuals: %#v", reviewed.DeliveryOutcome)
	}

	legacyMapping := legacyOwnerMapping{LegacyOwnerID: "legacy-owner", FirstPartyAccountID: ownerA, ReviewerID: ownerA, ReviewedAt: time.Now().UTC(), Reason: "Owner verified with an approved account link."}
	legacyRow := legacyMigrationRow{OwnerID: legacyMapping.LegacyOwnerID, RecordID: "legacy-project-1", Project: json.RawMessage(`{"title":"Imported CRM","brief":"Import 20 contacts and sync nightly.","scope":{"summary":"CRM import","domain":"integration","requirements":[{"id":"import","evidence":"Import 20 contacts"}]},"versions":[{"id":"legacy-baseline-1","at":"2026-10-01T12:00:00Z","estimate":{"hours":5,"baseHours":5,"low":4,"high":6,"tasks":[{"category":"mapping","label":"Field mapping"}]}}],"actuals":{"hours":{"mapping":7},"additionalHours":2,"synthetic":true}}`)}
	legacyPayload, legacyTitle, err := convertLegacyProject(legacyRow, legacyMapping)
	if err != nil {
		t.Fatalf("convertLegacyProject() error = %v", err)
	}
	if imported, reason := importLegacyRecord(context.Background(), store, legacyRow, legacyMapping, legacyPayload, legacyTitle); !imported || reason != "" {
		t.Fatalf("first migration import = (%v, %q)", imported, reason)
	}
	if imported, reason := importLegacyRecord(context.Background(), store, legacyRow, legacyMapping, legacyPayload, legacyTitle); imported || reason != "already_imported" {
		t.Fatalf("retry migration import = (%v, %q), want idempotent skip", imported, reason)
	}
	legacyRecordID := deterministicUUID(legacyRow.OwnerID + ":" + legacyRow.RecordID)
	legacyRead := call(http.MethodGet, "/v1/records/"+legacyRecordID, ownerA, "private-records:read", "")
	if legacyRead.Code != http.StatusOK || !strings.Contains(legacyRead.Body.String(), `"legacy-unknown"`) || !strings.Contains(legacyRead.Body.String(), `"synthetic":true`) {
		t.Fatalf("imported legacy archive did not preserve unknown provenance and synthetic actuals: %d %s", legacyRead.Code, legacyRead.Body.String())
	}
	rollback := rollbackLegacyMigration(context.Background(), []legacyMigrationRow{legacyRow}, map[string]legacyOwnerMapping{legacyMapping.LegacyOwnerID: legacyMapping}, store)
	if rollback.RolledBack != 1 || rollback.Rejected != 0 {
		t.Fatalf("migration rollback did not reconcile: %#v", rollback)
	}
	if response := call(http.MethodGet, "/v1/records/"+legacyRecordID, ownerA, "private-records:read", ""); response.Code != http.StatusNotFound {
		t.Fatalf("rolled-back legacy record returned %d: %s", response.Code, response.Body.String())
	}

	for _, attack := range []struct {
		name   string
		method string
		path   string
		scope  string
		body   string
	}{{
		name: "read another account record", method: http.MethodGet, path: "/v1/records/" + ownerBRecord, scope: "private-records:read",
	}, {
		name: "rename another account record", method: http.MethodPatch, path: "/v1/records/" + ownerBRecord, scope: "private-records:update", body: `{"title":"stolen rename"}`,
	}, {
		name: "delete another account record", method: http.MethodDelete, path: "/v1/records/" + ownerBRecord, scope: "private-records:delete",
	}} {
		t.Run(attack.name, func(t *testing.T) {
			response := call(attack.method, attack.path, ownerA, attack.scope, attack.body)
			if response.Code != http.StatusNotFound {
				t.Fatalf("cross-account operation returned %d, want 404: %s", response.Code, response.Body.String())
			}
		})
	}
	assertOnlyOwn(ownerA, ownerARecord, ownerBRecord)
	assertOnlyOwn(ownerB, ownerBRecord, ownerARecord)

	updateOwn := call(http.MethodPatch, "/v1/records/"+ownerARecord, ownerA, "private-records:update", `{"title":"Owner A renamed"}`)
	if updateOwn.Code != http.StatusOK {
		t.Fatalf("owner update returned %d: %s", updateOwn.Code, updateOwn.Body.String())
	}
	foreignDelete := call(http.MethodDelete, "/v1/records/"+ownerARecord, ownerB, "private-records:delete", "")
	if foreignDelete.Code != http.StatusNotFound {
		t.Fatalf("reverse cross-account delete returned %d, want 404", foreignDelete.Code)
	}
	assertOnlyOwn(ownerA, ownerARecord, ownerBRecord)
	assertOnlyOwn(ownerB, ownerBRecord, ownerARecord)
	ownerADelete := call(http.MethodDelete, "/v1/records/"+ownerARecord, ownerA, "private-records:delete", "")
	if ownerADelete.Code != http.StatusNoContent {
		t.Fatalf("owner delete returned %d, want 204: %s", ownerADelete.Code, ownerADelete.Body.String())
	}
	if ids := listIDs(ownerA); len(ids) != 0 {
		t.Fatalf("deleted owner workspace still contains records: %#v", ids)
	}
	assertOnlyOwn(ownerB, ownerBRecord, ownerARecord)
	ownerBDelete := call(http.MethodDelete, "/v1/records/"+ownerBRecord, ownerB, "private-records:delete", "")
	if ownerBDelete.Code != http.StatusNoContent {
		t.Fatalf("second owner delete returned %d, want 204: %s", ownerBDelete.Code, ownerBDelete.Body.String())
	}
}

func TestRequiredRecordScope(t *testing.T) {
	tests := []struct {
		method, path, want string
	}{
		{http.MethodGet, "/v1/records", "private-records:read"},
		{http.MethodGet, "/v1/records/0e7f3f96-7c9a-4db6-9a8d-35fe35ac9bce", "private-records:read"},
		{http.MethodPatch, "/v1/records/0e7f3f96-7c9a-4db6-9a8d-35fe35ac9bce", "private-records:update"},
		{http.MethodPost, "/v1/records", "private-records:create"},
		{http.MethodDelete, "/v1/records", "private-records:delete"},
		{http.MethodDelete, "/v1/records/0e7f3f96-7c9a-4db6-9a8d-35fe35ac9bce", "private-records:delete"},
		{http.MethodPut, "/v1/records", ""},
		{http.MethodPost, "/v1/records/unknown", ""},
	}
	for _, test := range tests {
		t.Run(fmt.Sprintf("%s %s", test.method, test.path), func(t *testing.T) {
			if got := requiredRecordScope(test.method, test.path); got != test.want {
				t.Fatalf("requiredRecordScope(%q, %q) = %q, want %q", test.method, test.path, got, test.want)
			}
		})
	}
}

func signedRecordServiceToken(t *testing.T, keyID string, includeKeyID bool, secret []byte, now time.Time, scope string, audience any, expiration int64) string {
	return signedRecordServiceTokenWithClaims(t, keyID, includeKeyID, secret, now, scope, audience, expiration, nil)
}

func signedRecordServiceTokenWithClaims(t *testing.T, keyID string, includeKeyID bool, secret []byte, now time.Time, scope string, audience any, expiration int64, overrides map[string]any) string {
	t.Helper()
	header := map[string]string{"alg": "HS256", "typ": "JWT"}
	if includeKeyID {
		header["kid"] = keyID
	}
	claims := map[string]any{
		"iss":                "the-estimator-web",
		"aud":                audience,
		"sub":                "0e7f3f96-7c9a-4db6-9a8d-35fe35ac9bce",
		"identity_authority": "first-party-v1",
		"email_verified":     true,
		"scope":              scope,
		"iat":                now.Unix(),
		"exp":                expiration,
		"jti":                "test-token-id",
	}
	for key, value := range overrides {
		claims[key] = value
	}
	headerBytes, err := json.Marshal(header)
	if err != nil {
		t.Fatal(err)
	}
	claimsBytes, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	encode := base64.RawURLEncoding.EncodeToString
	message := encode(headerBytes) + "." + encode(claimsBytes)
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(message))
	return message + "." + encode(mac.Sum(nil))
}
