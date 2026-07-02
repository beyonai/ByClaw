package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

public class SandboxCronPrewarmUserCandidate {

    private final Long userId;

    private final String userCode;

    public SandboxCronPrewarmUserCandidate(Long userId, String userCode) {
        this.userId = userId;
        this.userCode = userCode;
    }

    public Long getUserId() {
        return userId;
    }

    public String getUserCode() {
        return userCode;
    }

    public boolean isCursorTracked() {
        return userId != null;
    }
}
