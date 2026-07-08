package com.iwhalecloud.byai.gateway.channels.controller;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;

class FeishuBotEventControllerTest {

    @Test
    void controller_isOnlyEnabledWhenChannelStreamIsEnabled() {
        ConditionalOnProperty condition = FeishuBotEventController.class.getAnnotation(ConditionalOnProperty.class);

        assertThat(condition).isNotNull();
        assertThat(condition.name()).containsExactly("channel.stream.enabled");
        assertThat(condition.havingValue()).isEqualTo("true");
    }
}
