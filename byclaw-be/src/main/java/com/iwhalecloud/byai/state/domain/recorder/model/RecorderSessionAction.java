package com.iwhalecloud.byai.state.domain.recorder.model;

public enum RecorderSessionAction {
    CONFIRM_AUTH,
    NAVIGATE,
    CAPTURE_START,
    CAPTURE_READ,
    RANK,
    INIT,
    VERIFY,
    COMPLETE_VERIFY,
    FAIL_VERIFY,
    SAVE_ADAPTER,
    COMPLETE_SAVE,
    PIPELINE,
    CANCEL
}
