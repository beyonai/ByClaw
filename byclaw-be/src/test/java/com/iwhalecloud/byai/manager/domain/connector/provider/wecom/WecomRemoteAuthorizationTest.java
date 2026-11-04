package com.iwhalecloud.byai.manager.domain.connector.provider.wecom;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.file.Path;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandExecutor;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandResult;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.gateway.sandbox.service.UserSandboxResolver;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialWorkspaceService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorManifestCommandResolver;
import com.iwhalecloud.byai.manager.domain.connector.manifest.ConnectorManifestCanonicalizer;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.Users;

class WecomRemoteAuthorizationTest {
    @TempDir Path home;

    @Test
    void localAuthorizationCannotMaskAnUnauthorizedAgentSandbox() {
        ConnectorCliRunner local = mock(ConnectorCliRunner.class);
        when(local.run(any(), any(), any(), any()))
            .thenReturn(new ConnectorCliRunner.CliResult(0, "authorized\n"));
        ConnectorCredentialWorkspaceService workspaces = mock(ConnectorCredentialWorkspaceService.class);
        when(workspaces.resolve(10001L, "wecom-cli")).thenReturn(
            new ConnectorCredentialWorkspaceService.ConnectorCliWorkspace(home, Map.of("HOME", home.toString())));
        PlatformRemoteGateway gateway = mock(PlatformRemoteGateway.class);
        when(gateway.isRemote()).thenReturn(true);
        UserService users = mock(UserService.class);
        Users user = new Users();
        user.setUserCode("user-10001");
        when(users.findById(10001L)).thenReturn(user);
        UserSandboxResolver resolver = mock(UserSandboxResolver.class);
        when(resolver.resolve("user-10001")).thenReturn(
            new UserSandboxResolver.UserSandboxContext("agent-sandbox", "user-10001", null, null));
        SandboxCommandExecutor executor = mock(SandboxCommandExecutor.class);
        when(executor.run(eq("agent-sandbox"), any())).thenReturn(
            new SandboxCommandResult(0, "unauthorized\n", "", false, false));
        ObjectMapper mapper = new ObjectMapper();
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.getBeanFactory().registerSingleton("local", local);
            context.getBeanFactory().registerSingleton("workspaces", workspaces);
            context.getBeanFactory().registerSingleton("gateway", gateway);
            context.getBeanFactory().registerSingleton("users", users);
            context.getBeanFactory().registerSingleton("resolver", resolver);
            context.getBeanFactory().registerSingleton("executor", executor);
            context.getBeanFactory().registerSingleton("mapper", mapper);
            context.registerBean(ConnectorManifestCommandResolver.class, () ->
                new ConnectorManifestCommandResolver(mapper, new ConnectorManifestCanonicalizer(mapper)));
            context.scan("com.iwhalecloud.byai.manager.domain.connector.provider.wecom");
            context.refresh();
            ConnectorInfo connector = new ConnectorInfo();
            connector.setProviderCode("wecom-cli");
            connector.setConnectorCode("wecom");
            connector.setSkillCode("wecomcli");
            connector.setRuntimeManifest("""
                {"schemaVersion":"1.0","id":"wecom","version":"1.3.4",
                 "runtime":{"type":"cli","authorizeIn":"be-auth-job","commands":{
                   "login":[["wecom-cli","auth","init","--noninteractive","--no-browser"]],
                   "status":[["wecom-cli","auth","show","--status"]],
                   "logout":[["wecom-cli","cache","clear"]]}},
                 "authStorage":{"mode":"native-home","owner":"be-auth-job","runtimeMutation":"provider-refresh-only",
                   "nativePath":"/by/.connector-auth/.wecom-cli","environment":{"WECOM_HOME":"/by/.connector-auth/.wecom-cli"}},
                 "skill":{"code":"wecomcli","source":"system-builtin","installScope":"user","grantScope":"agent"}}
                """);
            assertEquals(AuthorizationStatus.FAILED,
                context.getBean(WecomCliAuthorizationProvider.class).verify(10001L, connector).status());
        }
    }
}
