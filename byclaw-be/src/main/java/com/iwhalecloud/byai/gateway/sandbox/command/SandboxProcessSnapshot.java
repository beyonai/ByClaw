package com.iwhalecloud.byai.gateway.sandbox.command;

public record SandboxProcessSnapshot(
    State state,
    Integer exitCode,
    String output,
    long nextCursor,
    boolean truncated
) {
    public enum State {
        RUNNING,
        EXITED,
        FAILED,
        TERMINATED,
        NOT_FOUND
    }
}
