package com.iwhalecloud.byai.manager.domain.connector.provider.lark;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;

import org.junit.jupiter.api.Test;

class LarkSandboxCommandPolicyTest {

    private final LarkSandboxCommandPolicy policy = new LarkSandboxCommandPolicy();

    @Test
    void buildsFixedUserAuthorizationCommandAndEnvironment() {
        var request = policy.build(LarkSandboxCommandPolicy.Action.START_USER_AUTHORIZATION);

        assertThat(request.argv()).containsExactly(
            "lark-cli", "auth", "login", "--domain", "all", "--no-wait", "--json");
        assertThat(request.environment()).containsEntry("HOME", "/by/.connector-auth/.lark-cli")
            .containsEntry("LARK_HOME", "/by/.connector-auth/.lark-cli");
        assertThat(request.background()).isFalse();
    }

    @Test
    void acceptsDeviceCodeOnlyForCompletionAction() {
        var request = policy.build(
            LarkSandboxCommandPolicy.Action.COMPLETE_USER_AUTHORIZATION,
            "device-code-1",
            Duration.ofMinutes(1),
            1024);

        assertThat(request.argv()).containsExactly(
            "lark-cli", "auth", "login", "--device-code", "device-code-1", "--json");
        assertThat(request.background()).isTrue();
    }

    @Test
    void buildsOpenClawBindingCommandWithUserIdentity() {
        var request = policy.build(LarkSandboxCommandPolicy.Action.BIND_OPENCLAW_CONTEXT);

        assertThat(request.argv()).containsExactly(
            "lark-cli", "config", "bind", "--source", "openclaw", "--identity", "user-default");
        assertThat(request.background()).isFalse();
    }

    @Test
    void rejectsControlCharactersAndMissingDeviceCode() {
        assertThatThrownBy(() -> policy.build(
            LarkSandboxCommandPolicy.Action.COMPLETE_USER_AUTHORIZATION,
            "device\ncode", Duration.ofMinutes(1), 1024))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> policy.build(
            LarkSandboxCommandPolicy.Action.COMPLETE_USER_AUTHORIZATION,
            null, Duration.ofMinutes(1), 1024))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
