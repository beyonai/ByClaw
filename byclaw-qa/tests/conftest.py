import os
import pytest
from unittest.mock import AsyncMock


# Ensure required env vars are set before any module that reads them at import time.
os.environ.setdefault("BYAI_REDIS_HOST", "localhost")
os.environ.setdefault("BYAI_REDIS_PORT", "6379")


@pytest.fixture
def mock_redis():
    return AsyncMock()
