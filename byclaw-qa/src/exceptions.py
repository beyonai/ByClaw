"""Standard exception types for byclaw-qa infrastructure clients."""

from __future__ import annotations


class ByclawQAError(Exception):
    """Base exception for all byclaw-qa errors."""

    def __init__(self, message: str, *, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class ConfigurationError(ByclawQAError):
    """Missing or invalid configuration (env vars, settings)."""
    pass


class StorageError(ByclawQAError):
    """Error communicating with object storage (MinIO/S3)."""
    pass


class ModelConfigError(ByclawQAError):
    """Error loading or parsing model configuration from Redis."""
    pass


class ModelNotFoundError(ModelConfigError):
    """Required model not found in Redis model registry."""
    pass
