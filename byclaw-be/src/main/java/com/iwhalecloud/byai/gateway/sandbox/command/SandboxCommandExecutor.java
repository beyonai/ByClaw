package com.iwhalecloud.byai.gateway.sandbox.command;

public interface SandboxCommandExecutor {

    SandboxCommandResult run(String sandboxId, SandboxCommandRequest request);

    SandboxProcessHandle start(String sandboxId, SandboxCommandRequest request);

    SandboxProcessSnapshot inspect(String sandboxId, String processId);

    SandboxProcessSnapshot readOutput(String sandboxId, String processId, long cursor);

    void terminate(String sandboxId, String processId);
}
