package com.iwhalecloud.byai.gateway.sandbox.command;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;

@Component
public class OpenSandboxCommandExecutor implements SandboxCommandExecutor {

    private final OpenSandboxClient client;

    public OpenSandboxCommandExecutor(OpenSandboxClient client) {
        this.client = client;
    }

    @Override
    public SandboxCommandResult run(String sandboxId, SandboxCommandRequest request) {
        return client.runCommand(sandboxId, request);
    }

    @Override
    public SandboxProcessHandle start(String sandboxId, SandboxCommandRequest request) {
        return client.startCommand(sandboxId, request);
    }

    @Override
    public SandboxProcessSnapshot inspect(String sandboxId, String processId) {
        return client.getCommandStatus(sandboxId, processId);
    }

    @Override
    public SandboxProcessSnapshot readOutput(String sandboxId, String processId, long cursor) {
        return client.getCommandLogs(sandboxId, processId, cursor);
    }

    @Override
    public void terminate(String sandboxId, String processId) {
        client.interruptCommand(sandboxId, processId);
    }
}
