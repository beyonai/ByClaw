from __future__ import annotations

import time
from enum import Enum


class CircuitState(Enum):
    CLOSED = 0
    OPEN = 1
    HALF_OPEN = 2


class CircuitBreaker:
    def __init__(
        self,
        *,
        failure_threshold: int = 5,
        open_duration: float = 30.0,
        half_open_max_requests: int = 1,
    ) -> None:
        self.failure_threshold = failure_threshold
        self.open_duration = open_duration
        self.half_open_max_requests = half_open_max_requests
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._opened_at: float | None = None
        self._half_open_in_flight: int = 0

    def _materialize_half_open(self) -> None:
        """Transition OPEN -> HALF_OPEN in-place if the cooldown has elapsed."""
        if self._state == CircuitState.OPEN and self._opened_at is not None:
            if time.monotonic() - self._opened_at >= self.open_duration:
                self._state = CircuitState.HALF_OPEN
                self._opened_at = None
                self._half_open_in_flight = 0

    @property
    def state(self) -> CircuitState:
        """Return the current state.

        The OPEN -> HALF_OPEN transition is materialised lazily on this
        property access: the *previous* state is returned for this call while
        ``_state`` is updated, so the next access reflects the new state.
        """
        s = self._state
        if s == CircuitState.OPEN and self._opened_at is not None:
            if time.monotonic() - self._opened_at >= self.open_duration:
                # Materialise for subsequent calls; return old state this time.
                self._state = CircuitState.HALF_OPEN
                self._opened_at = None
                self._half_open_in_flight = 0
        return s

    def before_call(self) -> bool:
        """Returns True if a request should be allowed through."""
        # Eagerly materialise so before_call sees the up-to-date state.
        self._materialize_half_open()
        s = self._state
        if s == CircuitState.CLOSED:
            return True
        if s == CircuitState.OPEN:
            return False
        # HALF_OPEN: allow up to half_open_max_requests in flight
        if self._half_open_in_flight < self.half_open_max_requests:
            self._half_open_in_flight += 1
            return True
        return False

    def record_success(self) -> None:
        self._materialize_half_open()
        if self._state == CircuitState.HALF_OPEN:
            self._half_open_in_flight = max(0, self._half_open_in_flight - 1)
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._opened_at = None

    def record_failure(self) -> None:
        self._materialize_half_open()
        s = self._state
        if s == CircuitState.HALF_OPEN:
            self._half_open_in_flight = max(0, self._half_open_in_flight - 1)
            self._state = CircuitState.OPEN
            self._opened_at = time.monotonic()
        elif s == CircuitState.CLOSED:
            self._failure_count += 1
            if self._failure_count >= self.failure_threshold:
                self._state = CircuitState.OPEN
                self._opened_at = time.monotonic()
        # OPEN: no-op


class CircuitBreakerRegistry:
    """Process-global per-endpoint circuit breaker registry."""

    def __init__(
        self,
        failure_threshold: int = 5,
        open_duration: float = 30.0,
        half_open_max_requests: int = 1,
    ) -> None:
        self._breakers: dict[str, CircuitBreaker] = {}
        self._kwargs = dict(
            failure_threshold=failure_threshold,
            open_duration=open_duration,
            half_open_max_requests=half_open_max_requests,
        )

    def get(self, endpoint_url: str) -> CircuitBreaker:
        if endpoint_url not in self._breakers:
            self._breakers[endpoint_url] = CircuitBreaker(**self._kwargs)
        return self._breakers[endpoint_url]
