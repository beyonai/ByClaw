package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

class WeixinOpenPlatformEventServiceTest {

    @Test
    void isCreatedBySpringWithRuntimeDependencies() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.registerBean(WeixinOpenPlatformConfigResolver.class,
                () -> mock(WeixinOpenPlatformConfigResolver.class));
            context.registerBean(WeixinOpenPlatformCrypto.class, () -> mock(WeixinOpenPlatformCrypto.class));
            context.registerBean(WeixinComponentTicketStore.class, () -> mock(WeixinComponentTicketStore.class));
            context.registerBean(WeixinAuthorizerAuthStore.class, () -> mock(WeixinAuthorizerAuthStore.class));
            context.registerBean(WeixinOpenPlatformEventService.class);

            assertThatCode(context::refresh).doesNotThrowAnyException();
            assertThat(context.getBean(WeixinOpenPlatformEventService.class)).isNotNull();
        }
    }

    @Test
    void decryptsAndStoresAComponentVerifyTicket() {
        Fixture fixture = new Fixture();
        long now = Instant.now().getEpochSecond();
        when(fixture.crypto.verifyAndDecrypt(
            "callback-token", "encoding-key", "wx-component", "signature",
            Long.toString(now), "nonce", "encrypted-value"))
            .thenReturn("<xml><AppId>wx-component</AppId><CreateTime>100</CreateTime>"
                + "<InfoType>component_verify_ticket</InfoType>"
                + "<ComponentVerifyTicket>ticket-value</ComponentVerifyTicket></xml>");

        assertThat(fixture.service.handle(
            "signature", Long.toString(now), "nonce",
            "<xml><Encrypt>encrypted-value</Encrypt></xml>"))
            .isEqualTo("success");

        verify(fixture.ticketStore).saveIfNewer("wx-component", "ticket-value", 100L);
    }

    @Test
    void revokesBindingsForAnUnauthorizedEvent() {
        Fixture fixture = new Fixture();
        long now = Instant.now().getEpochSecond();
        when(fixture.crypto.verifyAndDecrypt(
            "callback-token", "encoding-key", "wx-component", "signature",
            Long.toString(now), "nonce", "encrypted-value"))
            .thenReturn("<xml><AppId>wx-component</AppId><CreateTime>100</CreateTime>"
                + "<InfoType>unauthorized</InfoType><AuthorizerAppid>wx-authorizer</AuthorizerAppid></xml>");

        assertThat(fixture.service.handle(
            "signature", Long.toString(now), "nonce",
            "<xml><Encrypt>encrypted-value</Encrypt></xml>"))
            .isEqualTo("success");

        verify(fixture.authStore).revokeByAuthorizer("wx-authorizer");
    }

    @Test
    void rejectsStaleAndMalformedCallbacks() {
        Fixture fixture = new Fixture();
        long stale = Instant.now().minusSeconds(600).getEpochSecond();

        assertThatThrownBy(() -> fixture.service.handle(
            "signature", Long.toString(stale), "nonce", "<xml><Encrypt>x</Encrypt></xml>"))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> fixture.service.handle(
            "signature", "invalid", "nonce", "<xml/>"))
            .isInstanceOf(IllegalArgumentException.class);
    }

    private static final class Fixture {
        private final WeixinOpenPlatformConfigResolver configResolver = mock(WeixinOpenPlatformConfigResolver.class);
        private final WeixinOpenPlatformCrypto crypto = mock(WeixinOpenPlatformCrypto.class);
        private final WeixinComponentTicketStore ticketStore = mock(WeixinComponentTicketStore.class);
        private final WeixinAuthorizerAuthStore authStore = mock(WeixinAuthorizerAuthStore.class);
        private final WeixinOpenPlatformEventService service;

        private Fixture() {
            when(configResolver.resolveDefault()).thenReturn(new WeixinOpenPlatformConfig(
                "wx-component", "component-secret", "callback-token", "encoding-key", "https://example/callback"));
            service = new WeixinOpenPlatformEventService(configResolver, crypto, ticketStore, authStore);
        }
    }
}
