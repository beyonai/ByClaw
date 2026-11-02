"""Provider-neutral runtime primitives for the bundled mail connector."""

from .models import ErrorCode, MailRuntimeError
from .registry import AdapterRegistry, MailAdapter

__all__ = ["AdapterRegistry", "ErrorCode", "MailAdapter", "MailRuntimeError"]
