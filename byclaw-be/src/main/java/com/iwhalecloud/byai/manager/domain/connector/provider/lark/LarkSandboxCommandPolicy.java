package com.iwhalecloud.byai.manager.domain.connector.provider.lark;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandRequest;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorSandboxCommandLauncher;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorSandboxCommandLauncher.Profile;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ManifestCommandCatalog;

/** Builds the only Lark commands that the authorization runtime may execute. */
public final class LarkSandboxCommandPolicy {

    public enum Action {
        SHOW_CONFIG,
        INITIALIZE_APP,
        READ_USER_SCOPES,
        START_USER_AUTHORIZATION,
        START_USER_AUTHORIZATION_WITH_SCOPES,
        COMPLETE_USER_AUTHORIZATION,
        VERIFY_AUTHORIZATION,
        LOGOUT
    }

    private static final String HOME = "/by/.connector-auth/.lark-cli";
    private static final int DEFAULT_OUTPUT_LIMIT = 512 * 1024;
    private static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(30);
    private static final Set<String> COMPLETION_VALUE_FLAGS = Set.of(
        "--device-code", "--scope", "--domain", "--exclude", "--profile");

    public SandboxCommandRequest build(ManifestCommandCatalog catalog, Action action) {
        return build(catalog, action, null, DEFAULT_TIMEOUT, DEFAULT_OUTPUT_LIMIT);
    }

    public SandboxCommandRequest build(ManifestCommandCatalog catalog, Action action, String value,
                                       Duration timeout, int maxOutputBytes) {
        if (catalog == null || action == null || timeout == null || timeout.isZero() || timeout.isNegative()
                || maxOutputBytes <= 0) {
            throw new IllegalArgumentException("Invalid Lark sandbox command request");
        }
        List<String> argv = switch (action) {
            case SHOW_CONFIG -> catalog.command("configCheck", 0);
            case INITIALIZE_APP -> catalog.command("configInitialize", 0);
            case READ_USER_SCOPES -> catalog.command("scopesCheck", 0);
            case START_USER_AUTHORIZATION -> catalog.command("login", 0);
            case START_USER_AUTHORIZATION_WITH_SCOPES -> catalog.command(
                "loginWithScopes", 0, Map.of("userScopes", validateScopes(value)));
            case COMPLETE_USER_AUTHORIZATION -> catalog.command(
                "login", 1, Map.of("deviceCode", validateDeviceCode(value)));
            case VERIFY_AUTHORIZATION -> catalog.command("status", 0);
            case LOGOUT -> catalog.command("logout", 0);
        };
        validate(argv, action);
        return ConnectorSandboxCommandLauncher.wrap(Profile.LARK, new SandboxCommandRequest(
            argv,
            Map.of("HOME", HOME, "LARK_HOME", HOME),
            null,
            timeout,
            maxOutputBytes,
            action == Action.INITIALIZE_APP || action == Action.COMPLETE_USER_AUTHORIZATION
        ));
    }

    boolean completionUsesJson(ManifestCommandCatalog catalog, String deviceCode) {
        if (catalog == null) {
            throw new IllegalArgumentException("Invalid Lark sandbox command request");
        }
        List<String> argv = catalog.command("login", 1, Map.of("deviceCode", validateDeviceCode(deviceCode)));
        validate(argv, Action.COMPLETE_USER_AUTHORIZATION);
        boolean json = false;
        for (int index = 3; index < argv.size(); index++) {
            String argument = argv.get(index);
            if ("--".equals(argument)) {
                break;
            }
            if (COMPLETION_VALUE_FLAGS.contains(argument)) {
                // pflag consumes the next argument as a value even when it starts with "--".
                if (++index >= argv.size()) {
                    throw new IllegalArgumentException("Missing Lark completion flag value");
                }
            } else if ("--json".equals(argument)) {
                json = true;
            } else if (argument.startsWith("--json=")) {
                // Match Go strconv.ParseBool, which pflag uses; repeated flags use the last value.
                json = switch (argument.substring("--json=".length())) {
                    case "1", "t", "T", "TRUE", "true", "True" -> true;
                    case "0", "f", "F", "FALSE", "false", "False" -> false;
                    default -> throw new IllegalArgumentException("Invalid Lark JSON flag value");
                };
            }
        }
        return json;
    }

    private void validate(List<String> argv, Action action) {
        if (argv.size() < 3 || !"lark-cli".equals(argv.get(0))) {
            throw new IllegalArgumentException("Lark manifest command is not allowed");
        }
        String expectedGroup = switch (action) {
            case SHOW_CONFIG, INITIALIZE_APP -> "config";
            case READ_USER_SCOPES, START_USER_AUTHORIZATION, START_USER_AUTHORIZATION_WITH_SCOPES,
                 COMPLETE_USER_AUTHORIZATION, VERIFY_AUTHORIZATION, LOGOUT -> "auth";
        };
        String expectedSubcommand = switch (action) {
            case SHOW_CONFIG -> "show";
            case INITIALIZE_APP -> "init";
            case READ_USER_SCOPES -> "scopes";
            case START_USER_AUTHORIZATION, START_USER_AUTHORIZATION_WITH_SCOPES, COMPLETE_USER_AUTHORIZATION -> "login";
            case VERIFY_AUTHORIZATION -> "status";
            case LOGOUT -> "logout";
        };
        if (!expectedGroup.equals(argv.get(1)) || !expectedSubcommand.equals(argv.get(2))) {
            throw new IllegalArgumentException("Lark manifest command is not allowed");
        }
    }

    private String validateScopes(String value) {
        if (!ManifestCommandCatalog.PlaceholderPolicy.scopeList(64 * 1024).isValid(value)) {
            throw new IllegalArgumentException("Invalid Lark user scopes");
        }
        return value;
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
