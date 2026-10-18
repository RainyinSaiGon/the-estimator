"""Narrow BFF-to-brief-service authentication for internal analysis routes."""

from __future__ import annotations

import json
import os
import re
import uuid
from typing import Mapping

import jwt
from fastapi import Header, HTTPException


TOKEN_ISSUER = "the-estimator-web"
TOKEN_AUDIENCE = "the-estimator-brief-intelligence"
TOKEN_SUBJECT = "the-estimator-web"
TOKEN_MAX_LIFETIME_SECONDS = 60
KEY_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class ServiceAuthConfigurationError(ValueError):
    """Raised when the service key ring is absent or invalid."""


def configured_service_token_keys() -> dict[str, bytes]:
    active_key_id = os.environ.get("BRIEF_SERVICE_TOKEN_KEY_ID", "").strip()
    active_secret = os.environ.get("BRIEF_SERVICE_TOKEN_SECRET", "").strip()
    previous_raw = os.environ.get("BRIEF_SERVICE_TOKEN_VERIFICATION_KEYS", "").strip()
    if not active_key_id and not active_secret and not previous_raw:
        return {}
    if not KEY_ID_PATTERN.fullmatch(active_key_id) or len(active_secret.encode("utf-8")) < 32:
        raise ServiceAuthConfigurationError("brief service token active key configuration is invalid")

    keys = {active_key_id: active_secret.encode("utf-8")}
    if not previous_raw:
        return keys
    try:
        previous = json.loads(previous_raw)
    except json.JSONDecodeError as error:
        raise ServiceAuthConfigurationError("brief service token verification key ring is invalid") from error
    if not isinstance(previous, dict) or len(previous) > 8:
        raise ServiceAuthConfigurationError("brief service token verification key ring is invalid")
    for key_id, secret in previous.items():
        if (
            not isinstance(key_id, str)
            or not KEY_ID_PATTERN.fullmatch(key_id)
            or not isinstance(secret, str)
            or len(secret.encode("utf-8")) < 32
        ):
            raise ServiceAuthConfigurationError("brief service token verification key ring is invalid")
        encoded_secret = secret.encode("utf-8")
        if key_id in keys and keys[key_id] != encoded_secret:
            raise ServiceAuthConfigurationError("brief service token key ID has conflicting secrets")
        keys[key_id] = encoded_secret
    return keys


def verify_service_token(
    token: str,
    keys: Mapping[str, bytes],
    required_scope: str,
) -> None:
    if not token or len(token) > 10_000:
        raise jwt.InvalidTokenError("invalid service token")
    header = jwt.get_unverified_header(token)
    if header.get("alg") != "HS256" or header.get("typ") != "JWT":
        raise jwt.InvalidTokenError("invalid service token")
    key_id = header.get("kid")
    if not isinstance(key_id, str) or not KEY_ID_PATTERN.fullmatch(key_id):
        raise jwt.InvalidTokenError("invalid service token")
    key = keys.get(key_id)
    if key is None:
        raise jwt.InvalidTokenError("invalid service token")

    claims = jwt.decode(
        token,
        key,
        algorithms=["HS256"],
        issuer=TOKEN_ISSUER,
        audience=TOKEN_AUDIENCE,
        options={"require": ["iss", "aud", "sub", "scope", "iat", "exp", "jti"]},
    )
    if (
        claims.get("iss") != TOKEN_ISSUER
        or claims.get("aud") != TOKEN_AUDIENCE
        or claims.get("sub") != TOKEN_SUBJECT
        or claims.get("scope") != required_scope
        or type(claims.get("iat")) is not int
        or type(claims.get("exp")) is not int
        or not 0 < claims["exp"] - claims["iat"] <= TOKEN_MAX_LIFETIME_SECONDS
        or not isinstance(claims.get("jti"), str)
        or len(claims["jti"]) > 128
    ):
        raise jwt.InvalidTokenError("invalid service token")
    try:
        uuid.UUID(claims["jti"])
    except (ValueError, AttributeError) as error:
        raise jwt.InvalidTokenError("invalid service token") from error


def service_token_auth_status(authorization: str | None, required_scope: str) -> int | None:
    if not authorization or not authorization.startswith("Bearer ") or len(authorization) > 10_000:
        return 401
    try:
        keys = configured_service_token_keys()
    except ServiceAuthConfigurationError:
        return 503
    if not keys:
        return 503
    try:
        verify_service_token(authorization.removeprefix("Bearer "), keys, required_scope)
    except (jwt.PyJWTError, TypeError, ValueError):
        return 401
    return None


def analysis_service_auth(required_scope: str):
    async def authenticate(authorization: str | None = Header(default=None)) -> None:
        status = service_token_auth_status(authorization, required_scope)
        if status == 401:
            raise HTTPException(status_code=401, detail="A valid internal service credential is required.")
        if status == 503:
            raise HTTPException(status_code=503, detail="Internal service authentication is not configured.")
        return None

    return authenticate
