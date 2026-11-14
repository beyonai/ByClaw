package com.iwhalecloud.byai.common.constants.groupchat;

/**
 * Lifecycle statuses accepted by human-task list filters.
 *
 * @author Codex
 * @since 2026-11-14
 */
public final class HumanTaskStatus {
    public static final String PENDING = "PENDING";
    public static final String PENDING_REVIEW = "PENDING_REVIEW";
    public static final String CHANGES_REQUESTED = "CHANGES_REQUESTED";
    public static final String ACCEPTED = "ACCEPTED";

    private HumanTaskStatus() {
    }
}
