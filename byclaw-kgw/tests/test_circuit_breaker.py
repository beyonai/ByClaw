from __future__ import annotations

from kgw.resilience.circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerRegistry,
    CircuitState,
)


def test_initial_state_is_closed():
    cb = CircuitBreaker(failure_threshold=3, open_duration=30.0)
    assert cb.state == CircuitState.CLOSED
    assert cb.before_call() is True


def test_opens_after_threshold():
    cb = CircuitBreaker(failure_threshold=3, open_duration=30.0)
    for _ in range(3):
        assert cb.before_call()
        cb.record_failure()
    assert cb.state == CircuitState.OPEN
    assert cb.before_call() is False


def test_resets_failure_count_on_success():
    cb = CircuitBreaker(failure_threshold=3, open_duration=30.0)
    for _ in range(2):
        cb.before_call()
        cb.record_failure()
    cb.before_call()
    cb.record_success()
    assert cb.state == CircuitState.CLOSED
    assert cb._failure_count == 0


def test_transitions_to_half_open_after_duration():
    cb = CircuitBreaker(failure_threshold=1, open_duration=0.0)
    cb.before_call()
    cb.record_failure()
    assert cb.state == CircuitState.OPEN
    # With open_duration=0.0, monotonic() - opened_at >= 0.0 is always True
    assert cb.state == CircuitState.HALF_OPEN
    assert cb.before_call() is True


def test_half_open_success_closes():
    cb = CircuitBreaker(failure_threshold=1, open_duration=0.0)
    cb.before_call()
    cb.record_failure()
    cb.before_call()  # allowed in HALF_OPEN
    cb.record_success()
    assert cb.state == CircuitState.CLOSED


def test_half_open_failure_reopens():
    cb = CircuitBreaker(failure_threshold=1, open_duration=0.0)
    cb.before_call()
    cb.record_failure()
    cb.before_call()  # allowed in HALF_OPEN
    cb.record_failure()
    assert cb.state == CircuitState.OPEN


def test_half_open_blocks_second_request():
    cb = CircuitBreaker(
        failure_threshold=1, open_duration=0.0, half_open_max_requests=1
    )
    cb.before_call()
    cb.record_failure()
    assert cb.before_call() is True  # first half-open allowed (in-flight)
    assert cb.before_call() is False  # second blocked


def test_registry_returns_same_instance():
    reg = CircuitBreakerRegistry()
    cb1 = reg.get("http://kb.internal")
    cb2 = reg.get("http://kb.internal")
    assert cb1 is cb2


def test_registry_different_endpoints_independent():
    reg = CircuitBreakerRegistry(failure_threshold=1)
    cb1 = reg.get("http://kb-a.internal")
    cb1.before_call()
    cb1.record_failure()
    assert cb1.state == CircuitState.OPEN
    cb2 = reg.get("http://kb-b.internal")
    assert cb2.state == CircuitState.CLOSED


# ---- metrics existence smoke (validates T2 work will import cleanly) ----
def test_circuit_state_enum_values():
    assert CircuitState.CLOSED.value == 0
    assert CircuitState.OPEN.value == 1
    assert CircuitState.HALF_OPEN.value == 2
