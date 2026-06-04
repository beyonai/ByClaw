from __future__ import annotations

import pytest


def test_success_envelope_with_object():
    from kgw.envelope import success

    env = success({"foo": 1})
    assert env == {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {"foo": 1},
    }


def test_success_envelope_default_empty_object():
    from kgw.envelope import success

    env = success()
    assert env == {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {},
    }


def test_failure_envelope_basic():
    from kgw.envelope import failure

    env = failure(error_type="KBNotFound", message="kb not found: hr_policy")
    assert env["resultCode"] == "-1"
    assert env["resultMsg"] == "kb not found: hr_policy"
    assert env["resultObject"] == {"errorCode": "KBNotFound"}


def test_failure_envelope_with_extra():
    from kgw.envelope import failure

    env = failure(
        error_type="MetadataPropertyConflict",
        message="type mismatch",
        extra={
            "propertyName": "status",
            "expected": "string",
            "actual": "integer",
        },
    )
    assert env["resultObject"] == {
        "errorCode": "MetadataPropertyConflict",
        "propertyName": "status",
        "expected": "string",
        "actual": "integer",
    }


def test_kgw_error_carries_metadata():
    from kgw.envelope import KBNotFound, KgwError

    err = KBNotFound("kb not found: hr_policy", kn_code="hr_policy")
    assert isinstance(err, KgwError)
    assert err.error_type == "KBNotFound"
    assert err.message == "kb not found: hr_policy"
    assert err.extra == {"knCode": "hr_policy"}


def test_kgw_error_to_envelope():
    from kgw.envelope import AuthInfoNotFound

    err = AuthInfoNotFound("auth missing for user_0001", user_code="user_0001")
    env = err.to_envelope()
    assert env == {
        "resultCode": "-1",
        "resultMsg": "auth missing for user_0001",
        "resultObject": {"errorCode": "AuthInfoNotFound", "userCode": "user_0001"},
    }


@pytest.mark.parametrize(
    "cls_name,error_type",
    [
        ("KBNotFound", "KBNotFound"),
        ("OperationNotSupported", "OperationNotSupported"),
        ("UpstreamTimeout", "UpstreamTimeout"),
        ("UpstreamConnectError", "UpstreamConnectError"),
        ("UploadStreamBroken", "UploadStreamBroken"),
        ("DownloadStreamBroken", "DownloadStreamBroken"),
        ("AuthInfoNotFound", "AuthInfoNotFound"),
        ("BackendAuthFailed", "BackendAuthFailed"),
        ("CircuitOpen", "CircuitOpen"),
        ("MetadataPropertyNotFound", "MetadataPropertyNotFound"),
        ("MetadataPropertyConflict", "MetadataPropertyConflict"),
        ("MetadataPropertySyncFailed", "MetadataPropertySyncFailed"),
    ],
)
def test_all_error_classes_present(cls_name, error_type):
    """v5 spec §6.6 lists every error type the gateway must expose."""
    import kgw.envelope as envelope_module

    cls = getattr(envelope_module, cls_name)
    instance = cls("msg")
    assert instance.error_type == error_type
