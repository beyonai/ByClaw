import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from botocore.exceptions import ClientError

from minio_client import MinioResourceClient, _build_endpoint_url


# --- _build_endpoint_url ---

def test_build_endpoint_url_raises_when_missing():
    with patch.dict("os.environ", {}, clear=True):
        with pytest.raises(RuntimeError, match="MINIO_ENDPOINT"):
            _build_endpoint_url()


def test_build_endpoint_url_http_default():
    with patch.dict("os.environ", {"MINIO_ENDPOINT": "minio.local:9000"}):
        assert _build_endpoint_url() == "http://minio.local:9000"


def test_build_endpoint_url_strips_existing_scheme():
    with patch.dict("os.environ", {"MINIO_ENDPOINT": "http://minio.local:9000"}):
        assert _build_endpoint_url() == "http://minio.local:9000"


def test_build_endpoint_url_secure():
    with patch.dict(
        "os.environ",
        {"MINIO_ENDPOINT": "minio.local:9000", "MINIO_SECURE": "true"},
    ):
        assert _build_endpoint_url() == "https://minio.local:9000"


def test_build_endpoint_url_secure_strips_http():
    with patch.dict(
        "os.environ",
        {"MINIO_ENDPOINT": "http://minio.local:9000", "MINIO_SECURE": "true"},
    ):
        assert _build_endpoint_url() == "https://minio.local:9000"


# --- MinioResourceClient helpers ---

def _make_client(**kwargs) -> MinioResourceClient:
    return MinioResourceClient(
        session=MagicMock(),
        endpoint_url="http://minio.local:9000",
        access_key="ak",
        secret_key="sk",
        bucket="test-bucket",
        **kwargs,
    )


def _client_error(status_code: int) -> ClientError:
    return ClientError(
        {"Error": {"Code": "Error"}, "ResponseMetadata": {"HTTPStatusCode": status_code}},
        "GetObject",
    )


# --- _is_transient_error ---

def test_is_transient_error_500():
    assert MinioResourceClient._is_transient_error(_client_error(500)) is True


def test_is_transient_error_503():
    assert MinioResourceClient._is_transient_error(_client_error(503)) is True


def test_is_transient_error_404():
    assert MinioResourceClient._is_transient_error(_client_error(404)) is False


# --- download_object ---

@pytest.mark.asyncio
async def test_download_object_success():
    client = _make_client()
    body_mock = AsyncMock()
    body_mock.read.return_value = b"hello"
    s3_mock = AsyncMock()
    s3_mock.get_object.return_value = {"Body": body_mock}
    client.session.client.return_value.__aenter__ = AsyncMock(return_value=s3_mock)
    client.session.client.return_value.__aexit__ = AsyncMock(return_value=False)

    result = await client.download_object("some/key")
    assert result == b"hello"
    s3_mock.get_object.assert_called_once_with(Bucket="test-bucket", Key="some/key")


@pytest.mark.asyncio
async def test_download_object_non_transient_error_raises():
    client = _make_client(retries=2)
    s3_mock = AsyncMock()
    s3_mock.get_object.side_effect = _client_error(404)
    client.session.client.return_value.__aenter__ = AsyncMock(return_value=s3_mock)
    client.session.client.return_value.__aexit__ = AsyncMock(return_value=False)

    with pytest.raises(ClientError):
        await client.download_object("missing/key")
    assert s3_mock.get_object.call_count == 1


@pytest.mark.asyncio
async def test_download_object_retries_on_transient_error():
    client = _make_client(retries=3, retry_delay_seconds=0)
    body_mock = AsyncMock()
    body_mock.read.return_value = b"ok"
    s3_mock = AsyncMock()
    s3_mock.get_object.side_effect = [
        _client_error(503),
        {"Body": body_mock},
    ]
    client.session.client.return_value.__aenter__ = AsyncMock(return_value=s3_mock)
    client.session.client.return_value.__aexit__ = AsyncMock(return_value=False)

    result = await client.download_object("retry/key")
    assert result == b"ok"
    assert s3_mock.get_object.call_count == 2


@pytest.mark.asyncio
async def test_download_object_exhausts_retries():
    client = _make_client(retries=2, retry_delay_seconds=0)
    s3_mock = AsyncMock()
    s3_mock.get_object.side_effect = _client_error(500)
    client.session.client.return_value.__aenter__ = AsyncMock(return_value=s3_mock)
    client.session.client.return_value.__aexit__ = AsyncMock(return_value=False)

    with pytest.raises(ClientError):
        await client.download_object("fail/key")
    assert s3_mock.get_object.call_count == 2


# --- download_object_json ---

@pytest.mark.asyncio
async def test_download_object_json():
    client = _make_client()
    payload = {"resourceId": 123, "resourceCode": "1"}
    body_mock = AsyncMock()
    body_mock.read.return_value = json.dumps(payload).encode()
    s3_mock = AsyncMock()
    s3_mock.get_object.return_value = {"Body": body_mock}
    client.session.client.return_value.__aenter__ = AsyncMock(return_value=s3_mock)
    client.session.client.return_value.__aexit__ = AsyncMock(return_value=False)

    result = await client.download_object_json("config.json")
    assert result == payload


# --- get_kg_doc_config ---

@pytest.mark.asyncio
async def test_get_kg_doc_config_success():
    client = _make_client()
    config = {"resourceId": 10000003, "resourceCode": "1"}
    body_mock = AsyncMock()
    body_mock.read.return_value = json.dumps(config).encode()
    s3_mock = AsyncMock()
    s3_mock.get_object.return_value = {"Body": body_mock}
    client.session.client.return_value.__aenter__ = AsyncMock(return_value=s3_mock)
    client.session.client.return_value.__aexit__ = AsyncMock(return_value=False)

    result = await client.get_kg_doc_config("10000003")
    assert result == config
    s3_mock.get_object.assert_called_once_with(
        Bucket="test-bucket", Key="resource/doc/KG_DOC_10000003.json"
    )


@pytest.mark.asyncio
async def test_get_kg_doc_config_returns_none_on_error():
    client = _make_client()
    s3_mock = AsyncMock()
    s3_mock.get_object.side_effect = _client_error(404)
    client.session.client.return_value.__aenter__ = AsyncMock(return_value=s3_mock)
    client.session.client.return_value.__aexit__ = AsyncMock(return_value=False)

    result = await client.get_kg_doc_config("missing")
    assert result is None


# --- get_dig_employee_config ---

@pytest.mark.asyncio
async def test_get_dig_employee_config_success():
    client = _make_client()
    config = {"resourceId": 20000001, "resourceCode": "2"}
    body_mock = AsyncMock()
    body_mock.read.return_value = json.dumps(config).encode()
    s3_mock = AsyncMock()
    s3_mock.get_object.return_value = {"Body": body_mock}
    client.session.client.return_value.__aenter__ = AsyncMock(return_value=s3_mock)
    client.session.client.return_value.__aexit__ = AsyncMock(return_value=False)

    result = await client.get_dig_employee_config("20000001")
    assert result == config
    s3_mock.get_object.assert_called_once_with(
        Bucket="test-bucket", Key="resource/dig_employee/DIG_EMPLOYEE_20000001.json"
    )


@pytest.mark.asyncio
async def test_get_dig_employee_config_returns_none_on_error():
    client = _make_client()
    s3_mock = AsyncMock()
    s3_mock.get_object.side_effect = Exception("network error")
    client.session.client.return_value.__aenter__ = AsyncMock(return_value=s3_mock)
    client.session.client.return_value.__aexit__ = AsyncMock(return_value=False)

    result = await client.get_dig_employee_config("bad")
    assert result is None
