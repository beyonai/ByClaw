import pytest
from unittest.mock import AsyncMock


@pytest.fixture
def mock_redis():
    return AsyncMock()
