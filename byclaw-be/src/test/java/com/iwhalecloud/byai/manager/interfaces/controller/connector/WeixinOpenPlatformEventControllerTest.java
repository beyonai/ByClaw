package com.iwhalecloud.byai.manager.interfaces.controller.connector;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;

import com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen.WeixinOpenPlatformEventService;

class WeixinOpenPlatformEventControllerTest {
    private final WeixinOpenPlatformEventService service = mock(WeixinOpenPlatformEventService.class);
    private final WeixinOpenPlatformEventController controller = new WeixinOpenPlatformEventController(service);

    @Test
    void returnsExactNoStorePlainTextSuccess() {
        when(service.handle("signature", "100", "nonce", "<xml/>")) .thenReturn("success");

        var response = controller.receive("signature", "100", "nonce", request("<xml/>"));

        assertThat(response.getBody()).isEqualTo("success");
        assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        assertThat(response.getHeaders().getContentType().toString()).isEqualTo("text/plain;charset=UTF-8");
        verify(service).handle("signature", "100", "nonce", "<xml/>");
    }

    @Test
    void mapsInvalidOrOversizedRequestsToGenericBadRequest() {
        when(service.handle("signature", "100", "nonce", "bad"))
            .thenThrow(new IllegalArgumentException("private detail"));
        assertThatThrownBy(() -> controller.receive("signature", "100", "nonce", request("bad")))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST))
            .hasMessageNotContaining("private detail");
        assertThatThrownBy(() -> controller.receive(
            "signature", "100", "nonce", request("x".repeat(128 * 1024 + 1))))
            .isInstanceOf(ResponseStatusException.class);
    }

    private MockHttpServletRequest request(String body) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setContent(body.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return request;
    }
}
