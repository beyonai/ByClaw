from __future__ import annotations

import pytest


async def test_get_user_auth_returns_decoded_hash(fake_redis):
    from kgw.auth_provider import AuthProvider

    await fake_redis.hset(
        "user:user_0001:login:auth",
        mapping={"Authorization": "Bearer abc", "X-Api-Key": "xyz"},
    )

    provider = AuthProvider(fake_redis, key_template="user:{user_code}:login:auth")
    auth = await provider.get_user_auth("user_0001")
    assert auth == {"Authorization": "Bearer abc", "X-Api-Key": "xyz"}


async def test_get_user_auth_returns_none_when_missing(fake_redis):
    from kgw.auth_provider import AuthProvider

    provider = AuthProvider(fake_redis, key_template="user:{user_code}:login:auth")
    auth = await provider.get_user_auth("nobody")
    assert auth is None


async def test_resolve_headers_substitutes_placeholders(fake_redis):
    from kgw.auth_provider import AuthProvider

    await fake_redis.hset(
        "user:user_0001:login:auth",
        mapping={"Authorization": "Bearer abc", "X-Api-Key": "xyz"},
    )

    provider = AuthProvider(fake_redis, key_template="user:{user_code}:login:auth")
    resolved = await provider.resolve_headers(
        {
            "Authorization": "${Authorization}",
            "X-Api-Key": "${X-Api-Key}",
            "X-Static": "literal",
        },
        user_code="user_0001",
    )
    assert resolved == {
        "Authorization": "Bearer abc",
        "X-Api-Key": "xyz",
        "X-Static": "literal",
    }


async def test_resolve_headers_missing_placeholder_left_intact(fake_redis):
    """Missing fields leave the placeholder in the value (warning logged).

    Mirrors byclaw-qa _resolve_header_placeholders() behavior.
    """
    from kgw.auth_provider import AuthProvider

    await fake_redis.hset(
        "user:user_0001:login:auth",
        mapping={"Authorization": "Bearer abc"},
    )
    provider = AuthProvider(fake_redis, key_template="user:{user_code}:login:auth")
    resolved = await provider.resolve_headers(
        {"Authorization": "${Authorization}", "X-Api-Key": "${X-Api-Key}"},
        user_code="user_0001",
    )
    assert resolved == {"Authorization": "Bearer abc", "X-Api-Key": "${X-Api-Key}"}


async def test_resolve_headers_raises_when_user_auth_missing(fake_redis):
    """If the user has no auth hash AND headers contain placeholders, raise."""
    from kgw.auth_provider import AuthProvider
    from kgw.envelope import AuthInfoNotFound

    provider = AuthProvider(fake_redis, key_template="user:{user_code}:login:auth")
    with pytest.raises(AuthInfoNotFound):
        await provider.resolve_headers(
            {"Authorization": "${Authorization}"},
            user_code="ghost",
        )


async def test_resolve_headers_no_placeholders_no_redis_call(fake_redis):
    """Static headers must not trigger a Redis lookup."""
    from kgw.auth_provider import AuthProvider

    provider = AuthProvider(fake_redis, key_template="user:{user_code}:login:auth")
    resolved = await provider.resolve_headers(
        {"Content-Type": "application/json"},
        user_code="ghost",
    )
    assert resolved == {"Content-Type": "application/json"}


@pytest.mark.integration
async def test_auth_provider_integration(redis_url: str):
    """Integration test: seed real Redis and verify round-trip."""
    import redis.asyncio as redis_async
    from kgw.auth_provider import AuthProvider

    client = redis_async.from_url(redis_url, decode_responses=False)
    try:
        await client.hset(
            "user:integ_user:login:auth",
            mapping={"Authorization": "Bearer integ-token"},
        )
        provider = AuthProvider(client, key_template="user:{user_code}:login:auth")
        auth = await provider.get_user_auth("integ_user")
        assert auth == {"Authorization": "Bearer integ-token"}
    finally:
        await client.delete("user:integ_user:login:auth")
        await client.aclose()
