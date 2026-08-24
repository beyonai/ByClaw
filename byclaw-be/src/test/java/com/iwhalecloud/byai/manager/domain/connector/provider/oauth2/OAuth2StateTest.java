package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;

import org.junit.jupiter.api.Test;

class OAuth2StateTest {

    @Test
    void createsStateThatRecoversAuthorizationIdAndUsesIndependentRandomValue() {
        UUID authorizationId = UUID.randomUUID();

        String first = OAuth2State.create(authorizationId.toString());
        String second = OAuth2State.create(authorizationId.toString());

        assertThat(OAuth2State.authorizationId(first)).isEqualTo(authorizationId.toString());
        assertThat(first).isNotEqualTo(second);
        assertThat(first.substring(first.indexOf('.') + 1)).hasSizeGreaterThanOrEqualTo(43);
    }

    @Test
    void rejectsMalformedOrTamperedState() {
        String state = OAuth2State.create(UUID.randomUUID().toString());

        assertThatThrownBy(() -> OAuth2State.authorizationId("not-a-state"))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> OAuth2State.authorizationId(state + "!"))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
