package com.iwhalecloud.byai.manager.domain.connector.provider.lark;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandRequest;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ManifestCommandCatalog;

/** Builds the only Lark commands that the authorization runtime may execute. */
public final class LarkSandboxCommandPolicy {

    public enum Action {
        SHOW_CONFIG,
        INITIALIZE_APP,
        BIND_OPENCLAW_CONTEXT,
        START_USER_AUTHORIZATION,
        COMPLETE_USER_AUTHORIZATION,
        VERIFY_AUTHORIZATION,
        LOGOUT
    }

    private static final String HOME = "/by/.connector-auth/.lark-cli";
    private static final int DEFAULT_OUTPUT_LIMIT = 512 * 1024;
    private static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(30);

    public SandboxCommandRequest build(ManifestCommandCatalog catalog, Action action) {
        return build(catalog, action, null, DEFAULT_TIMEOUT, DEFAULT_OUTPUT_LIMIT);
    }

    public SandboxCommandRequest build(ManifestCommandCatalog catalog, Action action, String deviceCode,
                                       Duration timeout, int maxOutputBytes) {
        if (catalog == null || action == null || timeout == null || timeout.isZero() || timeout.isNegative()
                || maxOutputBytes <= 0) {
            throw new IllegalArgumentException("Invalid Lark sandbox command request");
        }
        List<String> argv = switch (action) {
            case SHOW_CONFIG -> catalog.command("configCheck", 0);
            case INITIALIZE_APP -> catalog.command("configInitialize", 0);
            case BIND_OPENCLAW_CONTEXT -> catalog.command("contextBind", 0);
            case START_USER_AUTHORIZATION -> catalog.command("login", 0);
            case COMPLETE_USER_AUTHORIZATION -> catalog.command(
                "login", 1, Map.of("deviceCode", validateDeviceCode(deviceCode)));
            case VERIFY_AUTHORIZATION -> catalog.command("status", 0);
            case LOGOUT -> catalog.command("logout", 0);
        };
        validate(argv, action);
        return new SandboxCommandRequest(
            argv,
            Map.of("HOME", HOME, "LARK_HOME", HOME),
            null,
            timeout,
            maxOutputBytes,
            action == Action.INITIALIZE_APP || action == Action.COMPLETE_USER_AUTHORIZATION
        );
    }

    private void validate(List<String> argv, Action action) {
        if (argv.size() < 3 || !"lark-cli".equals(argv.get(0))) {
            throw new IllegalArgumentException("Lark manifest command is not allowed");
        }
        String expectedGroup = switch (action) {
            case SHOW_CONFIG, INITIALIZE_APP, BIND_OPENCLAW_CONTEXT -> "config";
            case START_USER_AUTHORIZATION, COMPLETE_USER_AUTHORIZATION, VERIFY_AUTHORIZATION, LOGOUT -> "auth";
        };
        String expectedSubcommand = switch (action) {
            case SHOW_CONFIG -> "show";
            case INITIALIZE_APP -> "init";
            case BIND_OPENCLAW_CONTEXT -> "bind";
            case START_USER_AUTHORIZATION, COMPLETE_USER_AUTHORIZATION -> "login";
            case VERIFY_AUTHORIZATION -> "status";
            case LOGOUT -> "logout";
        };
        if (!expectedGroup.equals(argv.get(1)) || !expectedSubcommand.equals(argv.get(2))) {
            throw new IllegalArgumentException("Lark manifest command is not allowed");
        }
    }

    private String validateDeviceCode(String deviceCode) {
        if (deviceCode == null || deviceCode.isBlank() || deviceCode.length() > 512
                || deviceCode.codePoints().anyMatch(Character::isISOControl)
                || deviceCode.indexOf('\0') >= 0) {
            throw new IllegalArgumentException("Invalid Lark device code");
        }
        return deviceCode;
    }
}
