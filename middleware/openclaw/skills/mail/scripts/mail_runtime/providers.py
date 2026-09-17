from __future__ import annotations

from typing import Mapping

from .models import AccountConfig


def capability_descriptor(account: AccountConfig) -> Mapping[str, str]:
    """Consume the backend projection; do not maintain another provider catalog here."""
    if account.capability_status:
        return dict(account.capability_status)
    return {capability: "YES" for capability in account.capabilities}


def setup_requirements(account: AccountConfig) -> tuple[str, ...]:
    return tuple(account.setup_requirements)
