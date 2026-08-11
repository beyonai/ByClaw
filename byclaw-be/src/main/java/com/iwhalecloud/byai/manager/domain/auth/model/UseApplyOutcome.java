package com.iwhalecloud.byai.manager.domain.auth.model;

/**
 * Outcome of an idempotent resource use application attempt.
 */
public enum UseApplyOutcome {
    CREATED,
    PENDING,
    UNAVAILABLE
}
