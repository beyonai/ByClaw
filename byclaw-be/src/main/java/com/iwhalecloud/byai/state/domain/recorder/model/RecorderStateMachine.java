package com.iwhalecloud.byai.state.domain.recorder.model;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

public final class RecorderStateMachine {

    private static final Map<RecorderSessionAction, Set<RecorderSessionState>> ALLOWED_FROM =
        new EnumMap<>(RecorderSessionAction.class);

    static {
        ALLOWED_FROM.put(RecorderSessionAction.CONFIRM_AUTH, EnumSet.of(RecorderSessionState.AWAITING_USER_LOGIN));
        ALLOWED_FROM.put(RecorderSessionAction.NAVIGATE, EnumSet.of(
            RecorderSessionState.SESSION_BOUND,
            RecorderSessionState.AUTH_CONFIRMED,
            RecorderSessionState.PAGE_READY,
            RecorderSessionState.CAPTURE_A
        ));
        ALLOWED_FROM.put(RecorderSessionAction.CAPTURE_START, EnumSet.of(RecorderSessionState.PAGE_READY));
        ALLOWED_FROM.put(RecorderSessionAction.CAPTURE_READ, EnumSet.of(RecorderSessionState.PAGE_READY));
        ALLOWED_FROM.put(RecorderSessionAction.RANK, EnumSet.of(RecorderSessionState.CAPTURE_B));
        ALLOWED_FROM.put(RecorderSessionAction.INIT, EnumSet.of(RecorderSessionState.RANKED));
        ALLOWED_FROM.put(RecorderSessionAction.VERIFY, EnumSet.of(RecorderSessionState.DRAFT_CREATED));
        ALLOWED_FROM.put(RecorderSessionAction.COMPLETE_VERIFY, EnumSet.of(RecorderSessionState.VERIFYING));
        ALLOWED_FROM.put(RecorderSessionAction.FAIL_VERIFY, EnumSet.of(RecorderSessionState.VERIFYING));
        ALLOWED_FROM.put(RecorderSessionAction.SAVE_ADAPTER, EnumSet.of(RecorderSessionState.RANKED));
        ALLOWED_FROM.put(RecorderSessionAction.COMPLETE_SAVE, EnumSet.of(RecorderSessionState.RANKED));
        ALLOWED_FROM.put(RecorderSessionAction.PIPELINE, EnumSet.of(RecorderSessionState.RANKED));
        ALLOWED_FROM.put(RecorderSessionAction.CANCEL, EnumSet.complementOf(EnumSet.of(
            RecorderSessionState.DONE,
            RecorderSessionState.FAILED,
            RecorderSessionState.CANCELLED
        )));
    }

    private RecorderStateMachine() {
    }

    public static boolean canTransition(RecorderSessionState from, RecorderSessionAction action) {
        return ALLOWED_FROM.getOrDefault(action, Set.of()).contains(from);
    }
}
