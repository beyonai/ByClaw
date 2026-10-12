package com.iwhalecloud.byai.manager.domain.connector.provider.deepseek;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

class JdkDeepSeekWebSearchClientSpringTest {

    @Test
    void defaultProviderRequestTimeoutIsTwoMinutes() {
        assertThat(JdkDeepSeekWebSearchClient.DEFAULT_TIMEOUT_SECONDS).isEqualTo(120);
    }

    @Test
    void springCreatesClientThroughObjectMapperConstructor() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.registerBean(ObjectMapper.class, () -> new ObjectMapper());
            context.registerBean(JdkDeepSeekWebSearchClient.class);
            context.refresh();

            assertThat(context.getBean(JdkDeepSeekWebSearchClient.class)).isNotNull();
        }
    }
}
