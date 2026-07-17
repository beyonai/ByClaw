package com.iwhalecloud.byai.state.domain.recorder.model;

import java.util.Objects;

public record RecorderOwner(Long userId, String userCode) {

    public boolean sameAs(RecorderOwner other) {
        return other != null
            && Objects.equals(userId, other.userId)
            && Objects.equals(userCode, other.userCode);
    }
}
