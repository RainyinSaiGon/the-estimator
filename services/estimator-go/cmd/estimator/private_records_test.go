package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
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
		"scope":              scope,
		"iat":                now.Unix(),
		"exp":                expiration,
		"jti":                "test-token-id",
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
