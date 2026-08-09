package com.iwhalecloud.byai.manager.domain.connector.provider.lark;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandRequest;

/** Builds the only Lark commands that the authorization runtime may execute. */
public final class LarkSandboxCommandPolicy {

    public enum Action {
        SHOW_CONFIG,
        INITIALIZE_APP,
        BIND_OPENCLAW_CONTEXT,
        START_USER_AUTHORIZATION,
        COMPLETE_USER_AUTHORIZATION,
        VERIFY_AUTHORIZATION
    }

    private static final String HOME = "/by/.connector-auth/.lark-cli";
    private static final int DEFAULT_OUTPUT_LIMIT = 512 * 1024;
    private static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(30);

    public SandboxCommandRequest build(Action action) {
        return build(action, null, DEFAULT_TIMEOUT, DEFAULT_OUTPUT_LIMIT);
    }

    public SandboxCommandRequest build(Action action, String deviceCode,
                                       Duration timeout, int maxOutputBytes) {
        if (action == null || timeout == null || timeout.isZero() || timeout.isNegative()
                || maxOutputBytes <= 0) {
            throw new IllegalArgumentException("Invalid Lark sandbox command request");
        }
        List<String> argv = switch (action) {
            case SHOW_CONFIG -> List.of("lark-cli", "config", "show");
            case INITIALIZE_APP -> List.of("lark-cli", "config", "init", "--new", "--force-init");
            case BIND_OPENCLAW_CONTEXT -> List.of(
                "lark-cli", "config", "bind", "--source", "openclaw", "--identity", "user-default", "--force");
            case START_USER_AUTHORIZATION -> List.of(
                "lark-cli", "auth", "login", "--domain", "all", "--no-wait", "--json");
            case COMPLETE_USER_AUTHORIZATION -> List.of(
                "lark-cli", "auth", "login", "--device-code", validateDeviceCode(deviceCode), "--json");
            case VERIFY_AUTHORIZATION -> List.of("lark-cli", "auth", "status", "--json", "--verify");
        };
        return new SandboxCommandRequest(
            argv,
            Map.of("HOME", HOME, "LARK_HOME", HOME),
            null,
            timeout,
            maxOutputBytes,
            action == Action.INITIALIZE_APP || action == Action.COMPLETE_USER_AUTHORIZATION
        );
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
