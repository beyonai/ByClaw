package com.iwhalecloud.byai.gateway.sandbox.command;

import java.time.Duration;
import java.util.List;
import java.util.Map;

public record SandboxCommandRequest(
    List<String> argv,
    Map<String, String> environment,
    String workingDirectory,
    Duration timeout,
    int maxOutputBytes,
    boolean background
) {
}
