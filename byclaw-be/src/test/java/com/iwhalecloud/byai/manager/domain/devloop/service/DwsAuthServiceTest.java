package com.iwhalecloud.byai.manager.domain.devloop.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.CliResult;

class DwsAuthServiceTest {
    @TempDir Path root;

    @Test void authStatusUsesTheBoundedUserCommandRunner() {
        DwsAuthService service = new DwsAuthService();
        ConnectorCliRunner runner = mock(ConnectorCliRunner.class);
        LoginApplicationService login = mock(LoginApplicationService.class);
        UserBucketNamingService buckets = mock(UserBucketNamingService.class);
        LoginInfo owner = new LoginInfo();
        owner.setUserCode("user-code");
        when(login.getLoginInfo(42L)).thenReturn(owner);
        when(buckets.buildUserBucketName("user-code")).thenReturn("byclaw-user-code");
        ReflectionTestUtils.setField(service, "fileStorageRoot", root.toString());
        ReflectionTestUtils.setField(service, "loginApplicationService", login);
        ReflectionTestUtils.setField(service, "userBucketNamingService", buckets);
        ReflectionTestUtils.setField(service, "connectorCliRunner", runner);
        List<String> command = List.of("missing-test-dws", "auth", "status");
        when(runner.run(eq(command), anyMap(), isNull(), eq(Duration.ofSeconds(10))))
            .thenReturn(new CliResult(0, "{\"authenticated\":true,\"token_valid\":true}"));

        assertEquals(true, service.getAuthStatus(42L, command).get("authenticated"));
        verify(runner).run(eq(command), anyMap(), isNull(), eq(Duration.ofSeconds(10)));
    }

    @Test void legacyModeCanExecuteDwsInstalledOutsideTheRunnersFixedPath() throws Exception {
        Path bin = Files.createDirectories(root.resolve("appuser/.local/bin"));
        Path dws = Files.writeString(bin.resolve("dws"), "#!/bin/sh\nprintf '%s' '{\"authenticated\":true}'\n");
        Files.setPosixFilePermissions(dws, PosixFilePermissions.fromString("rwx------"));
        List<String> resolved = DwsAuthService.resolveLocalExecutable(List.of("dws", "auth", "status"), bin.toString());
        assertEquals(dws.toString(), resolved.getFirst());
        CliResult result = new ConnectorCliRunner().run(resolved, Map.of("HOME", root.toString()), null, Duration.ofSeconds(2));
        assertEquals(0, result.exitCode());
        assertEquals("{\"authenticated\":true}", result.output());
    }

    @Test void localLookupPreservesExplicitPathsArgumentsAndPathOrder() throws Exception {
        Path first = Files.createDirectories(root.resolve("first"));
        Path second = Files.createDirectories(root.resolve("second"));
        for (Path bin : List.of(first, second)) {
            Files.writeString(bin.resolve("dws"), "#!/bin/sh\n");
            Files.setPosixFilePermissions(bin.resolve("dws"), PosixFilePermissions.fromString("rwx------"));
        }
        List<String> command = List.of("dws", "argument with spaces", "$(literal)");
        List<String> resolved = DwsAuthService.resolveLocalExecutable(command, first + File.pathSeparator + second);
        assertEquals(first.resolve("dws").toString(), resolved.getFirst());
        assertEquals(command.subList(1, command.size()), resolved.subList(1, resolved.size()));
        List<String> explicit = List.of(second.resolve("dws").toString(), "auth");
        assertEquals(explicit, DwsAuthService.resolveLocalExecutable(explicit, first.toString()));
    }

    @Test void localEnvironmentPreservesTransportSettingsWithoutInheritingSharedCredentials() {
        Map<String, String> inherited = new HashMap<>();
        for (String key : List.of("HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy",
                "https_proxy", "no_proxy", "all_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR")) {
            inherited.put(key, "transport-fixture-" + key);
        }
        Map<String, String> expected = new HashMap<>(inherited);
        Map<String, String> isolated = Map.of("HOME", "/private/user-home", "DWS_HOME", "/private/user-home",
            "DWS_CONFIG_DIR", "/private/user-home/config", "DWS_DISABLE_KEYCHAIN", "1");
        expected.putAll(isolated);
        inherited.putAll(Map.of("HOME", "/shared", "DWS_HOME", "/shared", "DWS_CONFIG_DIR", "/shared/config",
            "DWS_CLIENT_ID", "shared-client", "DWS_CLIENT_SECRET", "test-only-secret", "UNRELATED_TOKEN", "test-only-token"));
        assertEquals(expected, DwsAuthService.localEnvironment(isolated, inherited));
        assertEquals(isolated, DwsAuthService.localEnvironment(isolated, Map.of()));
    }
}
