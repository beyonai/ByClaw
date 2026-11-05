package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandRequest;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorSandboxCommandLauncher.Profile;

class ConnectorSandboxCommandLauncherTest {
    @TempDir Path workspace;

    @Test
    void preservesTheCommandContractForEveryProfile() {
        for (Profile profile : Profile.values()) {
            SandboxCommandRequest request = new SandboxCommandRequest(List.of("cli", "a value", "--json"),
                Map.of("HOME", "private", "CUSTOM", "preserved"), "/by/work", Duration.ofMinutes(3), 2048, true);
            SandboxCommandRequest wrapped = ConnectorSandboxCommandLauncher.wrap(profile, request);
            assertThat(wrapped.argv().subList(5, wrapped.argv().size())).isEqualTo(request.argv());
            assertThat(wrapped.environment()).isEqualTo(request.environment());
            assertThat(wrapped.workingDirectory()).isEqualTo(request.workingDirectory());
            assertThat(wrapped.timeout()).isEqualTo(request.timeout());
            assertThat(wrapped.maxOutputBytes()).isEqualTo(request.maxOutputBytes());
            assertThat(wrapped.background()).isTrue();
        }
    }

    @Test
    void preservesDwsProfilesKeysAndLocksAndCreatesWritablePrivateDirectories() throws Exception {
        Path home = workspace.resolve(".connector-auth/.dws");
        List<String> files = List.of("config/profiles.json", "config/recovery/events/one.json",
            ".local/share/dws-cli/auth-token.enc", ".local/share/dws-cli/master.key",
            ".local/share/dws-cli/.data.lock");
        for (String name : files) {
            Path file = home.resolve(name);
            Files.createDirectories(file.getParent());
            Files.writeString(file, "original-" + name);
            Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-r--r--"));
        }
        Path lock = home.resolve(".local/share/dws-cli/.data.lock");
        Object lockIdentity = Files.getAttribute(lock, "unix:ino");
        Path sibling = Files.createDirectories(workspace.resolve(".connector-auth/.wecom-cli"));
        Files.setPosixFilePermissions(sibling, PosixFilePermissions.fromString("rwxr-x---"));

        Result result = executeDws(List.of("python3", "-c",
            "import os,pathlib; pathlib.Path(os.environ['HOME'],'config','written').write_text('yes'); print('executed')"), Map.of());

        assertThat(result.exitCode()).as(result.output()).isZero();
        assertThat(result.output().strip()).isEqualTo("executed");
        assertThat(Files.readString(home.resolve("config/written"))).isEqualTo("yes");
        for (String name : files) {
            assertThat(Files.readString(home.resolve(name))).isEqualTo("original-" + name);
            assertThat(PosixFilePermissions.toString(Files.getPosixFilePermissions(home.resolve(name))))
                .isEqualTo("rw-------");
        }
        assertThat(Files.getAttribute(lock, "unix:ino")).isEqualTo(lockIdentity);
        assertThat(PosixFilePermissions.toString(Files.getPosixFilePermissions(sibling))).isEqualTo("rwxr-x---");
    }

    @Test
    void rejectsDwsCredentialLinksAndConfigOverridesWithoutExecuting() throws Exception {
        Path keychain = Files.createDirectories(workspace.resolve(".connector-auth/.dws/.local/share/dws-cli"));
        Path outside = Files.writeString(workspace.resolve("outside"), "original-token");
        Files.setPosixFilePermissions(outside, PosixFilePermissions.fromString("rw-r-----"));
        Path key = keychain.resolve("auth-token.enc");
        Files.createSymbolicLink(key, outside);
        Result symlink = executeDws(List.of("python3", "-c", "print('executed')"), Map.of());
        assertThat(symlink.exitCode()).isNotZero();
        assertThat(symlink.output()).doesNotContain("executed");
        Files.delete(key);
        Files.createLink(key, outside);
        assertThat(executeDws(List.of("python3", "-c", "print('executed')"), Map.of()).exitCode()).isNotZero();
        Files.delete(key);
        Result override = executeDws(List.of("python3", "-c", "print('executed')"),
            Map.of("DWS_CONFIG_DIR", outside.toString()));
        assertThat(override.exitCode()).isNotZero();
        assertThat(override.output()).contains("private path override").doesNotContain("executed");
        assertThat(Files.readString(outside)).isEqualTo("original-token");
        assertThat(PosixFilePermissions.toString(Files.getPosixFilePermissions(outside))).isEqualTo("rw-r-----");
    }

    private Result executeDws(List<String> command, Map<String, String> overrides) throws Exception {
        List<String> argv = new ArrayList<>(ConnectorSandboxCommandLauncher.wrap(Profile.DWS,
            new SandboxCommandRequest(command, Map.of(), null, Duration.ofSeconds(10), 4096, false)).argv());
        argv.set(2, argv.get(2).replace("'/by'", "'" + workspace + "'"));
        ProcessBuilder builder = new ProcessBuilder(argv).redirectErrorStream(true);
        builder.environment().remove("DWS_HOME");
        builder.environment().remove("DWS_CONFIG_DIR");
        builder.environment().put("HOME", workspace.resolve(".connector-auth/.dws").toString());
        builder.environment().put("DWS_DISABLE_KEYCHAIN", "1");
        builder.environment().putAll(overrides);
        Process process = builder.start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        return new Result(process.waitFor(), output);
    }

    @Test
    void preservesLarkKeysLocksAndScopeCacheWhileRestrictingKnownPrivateFiles() throws Exception {
        Path home = workspace.resolve(".connector-auth/.lark-cli");
        List<String> files = List.of(".lark-cli/config.json", ".lark-cli/locks/refresh_app_user.lock",
            ".lark-cli/cache/auth_login_scopes/app_user.json", ".lark-cli/logs/auth-2026-11-04.log",
            ".lark-cli/openclaw/config.json", ".lark-cli/openclaw/locks/refresh_app_user.lock",
            ".local/share/lark-cli/master.key", ".local/share/lark-cli/appsecret_app.enc",
            ".local/share/lark-cli/app_user.enc");
        for (String name : files) {
            Path file = home.resolve(name);
            Files.createDirectories(file.getParent());
            Files.writeString(file, "original-" + name);
            Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-r--r--"));
        }
        Path key = home.resolve(".local/share/lark-cli/master.key");
        Object keyIdentity = Files.getAttribute(key, "unix:ino");
        Path sibling = Files.createDirectories(workspace.resolve(".connector-auth/.dws"));
        Files.setPosixFilePermissions(sibling, PosixFilePermissions.fromString("rwxr-x---"));
        Path unrelated = home.resolve(".local/share/lark-cli/still-writing.tmp");
        Files.writeString(unrelated, "untouched");
        Files.setPosixFilePermissions(unrelated, PosixFilePermissions.fromString("rw-r-----"));

        Result result = execute(Profile.LARK, List.of("python3", "-c", "print('executed')"), Map.of());

        assertThat(result.exitCode()).as(result.output()).isZero();
        assertThat(result.output().strip()).isEqualTo("executed");
        for (String name : files) {
            assertThat(Files.readString(home.resolve(name))).isEqualTo("original-" + name);
            assertThat(PosixFilePermissions.toString(Files.getPosixFilePermissions(home.resolve(name)))).isEqualTo("rw-------");
        }
        assertThat(Files.getAttribute(key, "unix:ino")).isEqualTo(keyIdentity);
        assertThat(PosixFilePermissions.toString(Files.getPosixFilePermissions(sibling))).isEqualTo("rwxr-x---");
        assertThat(PosixFilePermissions.toString(Files.getPosixFilePermissions(unrelated))).isEqualTo("rw-r-----");
    }

    @Test
    void rejectsLarkKeyLinksWithoutExecutingOrChangingTheirTargets() throws Exception {
        Path keychain = Files.createDirectories(workspace.resolve(".connector-auth/.lark-cli/.local/share/lark-cli"));
        Path outside = Files.writeString(workspace.resolve("outside"), "original-key");
        Files.setPosixFilePermissions(outside, PosixFilePermissions.fromString("rw-r-----"));
        Path key = keychain.resolve("master.key");
        Files.createSymbolicLink(key, outside);
        Result symlink = execute(Profile.LARK, List.of("python3", "-c", "print('executed')"), Map.of());
        assertThat(symlink.exitCode()).isNotZero();
        assertThat(symlink.output()).doesNotContain("executed");
        Files.delete(key);
        Files.createLink(key, outside);
        Result hardlink = execute(Profile.LARK, List.of("python3", "-c", "print('executed')"), Map.of());
        assertThat(hardlink.exitCode()).isNotZero();
        assertThat(hardlink.output()).doesNotContain("executed");
        assertThat(Files.readString(outside)).isEqualTo("original-key");
        assertThat(PosixFilePermissions.toString(Files.getPosixFilePermissions(outside))).isEqualTo("rw-r-----");
    }

    @Test
    void rejectsDirectoryLinksAndUnmanagedCredentialPathOverrides() throws Exception {
        Path home = Files.createDirectories(workspace.resolve(".connector-auth/.lark-cli"));
        Path outside = Files.createDirectory(workspace.resolve("outside"));
        Files.createSymbolicLink(home.resolve(".local"), outside);
        assertThat(execute(Profile.LARK, List.of("python3", "-c", "print('executed')"), Map.of()).exitCode()).isNotZero();
        Files.delete(home.resolve(".local"));
        Result result = execute(Profile.LARK, List.of("python3", "-c", "print('executed')"),
            Map.of("LARKSUITE_CLI_DATA_DIR", outside.toString()));
        assertThat(result.exitCode()).isNotZero();
        assertThat(result.output()).contains("private path override").doesNotContain("executed");
    }

    private Result execute(Profile profile, List<String> command, Map<String, String> overrides) throws Exception {
        String home = workspace.resolve(".connector-auth/" + (profile == Profile.LARK ? ".lark-cli" : ".wecom-cli")).toString();
        SandboxCommandRequest request = ConnectorSandboxCommandLauncher.wrap(profile,
            new SandboxCommandRequest(command, Map.of("HOME", home), null, Duration.ofSeconds(10), 4096, false));
        List<String> argv = new ArrayList<>(request.argv());
        argv.set(2, argv.get(2).replace("'/by'", "'" + workspace + "'"));
        ProcessBuilder builder = new ProcessBuilder(argv).redirectErrorStream(true);
        for (String key : List.of("LARKSUITE_CLI_CONFIG_DIR", "LARKSUITE_CLI_DATA_DIR", "LARKSUITE_CLI_LOG_DIR", "LARK_HOME")) {
            builder.environment().remove(key);
        }
        builder.environment().putAll(request.environment());
        builder.environment().putAll(overrides);
        Process process = builder.start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        return new Result(process.waitFor(), output);
    }

    private record Result(int exitCode, String output) { }
}
