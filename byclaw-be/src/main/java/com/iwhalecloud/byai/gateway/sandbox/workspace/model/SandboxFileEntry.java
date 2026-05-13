package com.iwhalecloud.byai.gateway.sandbox.workspace.model;

import java.time.Instant;

public record SandboxFileEntry(
    String name,
    boolean isDirectory,
    long size,
    Instant lastModified
) {
}
