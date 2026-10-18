from __future__ import annotations

import asyncio
import json
import os
import time
import unittest
import uuid
from unittest.mock import patch

import jwt
from fastapi import HTTPException

from service_auth import (
    ServiceAuthConfigurationError,
    analysis_service_auth,
    configured_service_token_keys,
    verify_service_token,
)


ACTIVE_SECRET = "brief-service-test-secret-0123456789-abcdef-long"
PREVIOUS_SECRET = "brief-service-previous-secret-0123456789-abcdef-rotation"
ACTIVE_KEY_ID = "brief-test-2026-10"
EXPECTED_SCOPE = "briefs:analyze"


def signed_token(
    *,
    secret: str = ACTIVE_SECRET,
    key_id: str = ACTIVE_KEY_ID,
    overrides: dict[str, object] | None = None,
    omit: tuple[str, ...] = (),
    algorithm: str = "HS256",
) -> str:
    now = int(time.time())
    claims: dict[str, object] = {
        "iss": "the-estimator-web",
        "aud": "the-estimator-brief-intelligence",
        "sub": "the-estimator-web",
        "scope": EXPECTED_SCOPE,
        "iat": now,
        "exp": now + 45,
        "jti": str(uuid.uuid4()),
    }
    claims.update(overrides or {})
    for name in omit:
        claims.pop(name, None)
    return jwt.encode(claims, secret, algorithm=algorithm, headers={"typ": "JWT", "kid": key_id})


class ServiceTokenTests(unittest.TestCase):
    def test_configured_key_ring_accepts_active_and_previous_keys(self) -> None:
        with patch.dict(os.environ, {
            "BRIEF_SERVICE_TOKEN_KEY_ID": ACTIVE_KEY_ID,
            "BRIEF_SERVICE_TOKEN_SECRET": ACTIVE_SECRET,
            "BRIEF_SERVICE_TOKEN_VERIFICATION_KEYS": json.dumps({"previous": PREVIOUS_SECRET}),
        }, clear=False):
            keys = configured_service_token_keys()
        self.assertEqual(keys[ACTIVE_KEY_ID], ACTIVE_SECRET.encode())
        self.assertEqual(keys["previous"], PREVIOUS_SECRET.encode())

    def test_missing_configuration_is_explicitly_unavailable(self) -> None:
        with patch.dict(os.environ, {
            "BRIEF_SERVICE_TOKEN_KEY_ID": "",
            "BRIEF_SERVICE_TOKEN_SECRET": "",
            "BRIEF_SERVICE_TOKEN_VERIFICATION_KEYS": "",
        }, clear=False):
            self.assertEqual(configured_service_token_keys(), {})

    def test_authenticated_analysis_fails_closed_when_key_ring_is_unconfigured(self) -> None:
        dependency = analysis_service_auth(EXPECTED_SCOPE)
        with patch.dict(os.environ, {
            "BRIEF_SERVICE_TOKEN_KEY_ID": "",
            "BRIEF_SERVICE_TOKEN_SECRET": "",
            "BRIEF_SERVICE_TOKEN_VERIFICATION_KEYS": "",
        }, clear=False):
            with self.assertRaises(HTTPException) as missing:
                asyncio.run(dependency(None))
            self.assertEqual(missing.exception.status_code, 401)
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(dependency("Bearer " + signed_token()))
        self.assertEqual(raised.exception.status_code, 503)

    def test_invalid_active_and_rotation_configuration_fails_closed(self) -> None:
        invalid_settings = [
            {"BRIEF_SERVICE_TOKEN_KEY_ID": "", "BRIEF_SERVICE_TOKEN_SECRET": ACTIVE_SECRET},
            {"BRIEF_SERVICE_TOKEN_KEY_ID": ACTIVE_KEY_ID, "BRIEF_SERVICE_TOKEN_SECRET": "short"},
            {"BRIEF_SERVICE_TOKEN_KEY_ID": "bad key", "BRIEF_SERVICE_TOKEN_SECRET": ACTIVE_SECRET},
            {
                "BRIEF_SERVICE_TOKEN_KEY_ID": ACTIVE_KEY_ID,
                "BRIEF_SERVICE_TOKEN_SECRET": ACTIVE_SECRET,
                "BRIEF_SERVICE_TOKEN_VERIFICATION_KEYS": "not-json",
            },
            {
                "BRIEF_SERVICE_TOKEN_KEY_ID": ACTIVE_KEY_ID,
                "BRIEF_SERVICE_TOKEN_SECRET": ACTIVE_SECRET,
                "BRIEF_SERVICE_TOKEN_VERIFICATION_KEYS": json.dumps({"old": "short"}),
            },
            {
                "BRIEF_SERVICE_TOKEN_KEY_ID": ACTIVE_KEY_ID,
                "BRIEF_SERVICE_TOKEN_SECRET": ACTIVE_SECRET,
                "BRIEF_SERVICE_TOKEN_VERIFICATION_KEYS": json.dumps({ACTIVE_KEY_ID: PREVIOUS_SECRET}),
            },
        ]
        for settings in invalid_settings:
            with self.subTest(settings=settings), patch.dict(os.environ, settings, clear=False):
                with self.assertRaises(ServiceAuthConfigurationError):
                    configured_service_token_keys()

    def test_valid_service_token_is_accepted(self) -> None:
        verify_service_token(signed_token(), {ACTIVE_KEY_ID: ACTIVE_SECRET.encode()}, EXPECTED_SCOPE)

    def test_previous_key_is_accepted_during_rotation(self) -> None:
        token = signed_token(secret=PREVIOUS_SECRET, key_id="previous")
        verify_service_token(token, {"previous": PREVIOUS_SECRET.encode()}, EXPECTED_SCOPE)

    def test_invalid_service_tokens_are_rejected(self) -> None:
        now = int(time.time())
        cases = [
            ("unknown key ID", signed_token(key_id="unknown"), {ACTIVE_KEY_ID: ACTIVE_SECRET.encode()}),
            ("wrong issuer", signed_token(overrides={"iss": "another-service"}), {ACTIVE_KEY_ID: ACTIVE_SECRET.encode()}),
            ("wrong audience", signed_token(overrides={"aud": "the-estimator-go"}), {ACTIVE_KEY_ID: ACTIVE_SECRET.encode()}),
            ("multiple audiences", signed_token(overrides={"aud": ["the-estimator-brief-intelligence", "another-service"]}), {ACTIVE_KEY_ID: ACTIVE_SECRET.encode()}),
            ("wrong subject", signed_token(overrides={"sub": "browser-user"}), {ACTIVE_KEY_ID: ACTIVE_SECRET.encode()}),
            ("wrong scope", signed_token(overrides={"scope": "private-records:read"}), {ACTIVE_KEY_ID: ACTIVE_SECRET.encode()}),
            ("expired", signed_token(overrides={"iat": now - 90, "exp": now - 45}), {ACTIVE_KEY_ID: ACTIVE_SECRET.encode()}),
            ("lifetime over one minute", signed_token(overrides={"iat": now, "exp": now + 61}), {ACTIVE_KEY_ID: ACTIVE_SECRET.encode()}),
            ("missing issued at", signed_token(omit=("iat",)), {ACTIVE_KEY_ID: ACTIVE_SECRET.encode()}),
            ("missing expiry", signed_token(omit=("exp",)), {ACTIVE_KEY_ID: ACTIVE_SECRET.encode()}),
            ("missing token ID", signed_token(omit=("jti",)), {ACTIVE_KEY_ID: ACTIVE_SECRET.encode()}),
            ("invalid token ID", signed_token(overrides={"jti": "not-a-uuid"}), {ACTIVE_KEY_ID: ACTIVE_SECRET.encode()}),
            ("unsupported algorithm", signed_token(algorithm="HS384"), {ACTIVE_KEY_ID: ACTIVE_SECRET.encode()}),
            ("empty key ring", signed_token(), {}),
        ]
        for name, token, keys in cases:
            with self.subTest(name=name), self.assertRaises(jwt.PyJWTError):
                verify_service_token(token, keys, EXPECTED_SCOPE)


if __name__ == "__main__":
    unittest.main()
