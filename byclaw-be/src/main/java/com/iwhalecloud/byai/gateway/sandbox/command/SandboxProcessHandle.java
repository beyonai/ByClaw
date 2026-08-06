package com.iwhalecloud.byai.gateway.sandbox.command;

import java.time.Instant;

public record SandboxProcessHandle(String sandboxId, String processId, Instant startedAt) {
}
