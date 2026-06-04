import pytest


async def test_fake_redis_fixture_works(fake_redis):
    """Unit-test fixture: fakeredis works without a real Redis."""
    await fake_redis.set("k", "v")
    assert await fake_redis.get("k") == b"v"


@pytest.mark.integration
async def test_postgres_fixture_alive(pg_dsn: str):
    """The pg fixture should yield a usable DSN."""
    import psycopg

    async with await psycopg.AsyncConnection.connect(pg_dsn) as conn:
        cur = await conn.execute("SELECT 1 AS ok")
        row = await cur.fetchone()
        assert row[0] == 1


@pytest.mark.integration
async def test_redis_fixture_alive(redis_url: str):
    import redis.asyncio as redis_async

    client = redis_async.from_url(redis_url)
    try:
        pong = await client.ping()
        assert pong is True
    finally:
        await client.aclose()


@pytest.mark.integration
async def test_minio_fixture_alive(minio_settings: dict):
    import aioboto3

    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=minio_settings["endpoint_url"],
        aws_access_key_id=minio_settings["access_key"],
        aws_secret_access_key=minio_settings["secret_key"],
    ) as s3:
        result = await s3.list_buckets()
        assert "Buckets" in result
