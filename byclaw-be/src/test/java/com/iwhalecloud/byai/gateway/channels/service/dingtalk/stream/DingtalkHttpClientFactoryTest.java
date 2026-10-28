package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config.DingtalkStreamProperties;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.*;

class DingtalkHttpClientFactoryTest {
    @Test
    void appliesConfiguredBudgetsToLegacySdkCardsWebhooksAndDownloads() throws Exception {
        DingtalkStreamProperties properties = new DingtalkStreamProperties();
        properties.getHttp().setConnectTimeoutMillis(1234);
        properties.getHttp().setReadTimeoutMillis(2345);
        properties.getHttp().setRequestTimeoutMillis(3456);
        properties.getHttp().setFileTimeoutMillis(4567);
        DingtalkHttpClientFactory factory = new DingtalkHttpClientFactory(properties);

        var legacy = factory.legacyClient("https://example.test");
        assertThat(ReflectionTestUtils.getField(legacy, "connectTimeout")).isEqualTo(1234);
        assertThat(ReflectionTestUtils.getField(legacy, "readTimeout")).isEqualTo(2345);
        var card = factory.cardClient();
        assertThat(card._connectTimeout).isEqualTo(1234);
        assertThat(card._readTimeout).isEqualTo(2345);
        assertThat(factory.cardRuntimeOptions().getAutoretry()).isFalse();
        assertThat(factory.cardRuntimeOptions().getReadTimeout()).isEqualTo(2345);
        assertThat(factory.webhookClient().callTimeoutMillis()).isEqualTo(3456);
        assertThat(factory.fileClient().callTimeoutMillis()).isEqualTo(4567);
        assertThat(factory.fileClient().connectTimeoutMillis()).isEqualTo(1234);
    }

    @Test
    void rejectsZeroBudgetsRatherThanSilentlyDisablingTimeouts() {
        DingtalkStreamProperties properties = new DingtalkStreamProperties();
        properties.getHttp().setRequestTimeoutMillis(0);

        assertThatIllegalArgumentException().isThrownBy(() -> new DingtalkHttpClientFactory(properties));
    }
}
