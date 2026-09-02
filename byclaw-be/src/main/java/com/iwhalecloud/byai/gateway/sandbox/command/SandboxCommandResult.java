package com.iwhalecloud.byai.gateway.sandbox.command;

public record SandboxCommandResult(
    int exitCode,
    String stdout,
    String stderr,
    boolean truncated,
    boolean timedOut
) {
}
