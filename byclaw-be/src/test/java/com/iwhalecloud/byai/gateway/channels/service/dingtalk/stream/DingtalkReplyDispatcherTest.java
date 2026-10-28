package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;
import org.junit.jupiter.api.Test;

import java.io.IOException;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class DingtalkReplyDispatcherTest {
    @Test
    void surfacesDingTalkApplicationErrorEvenWhenHttpStatusIsSuccessful() throws Exception {
        DingtalkReplyDispatcher dispatcher = dispatcher(200, "{\"errcode\":40014,\"errmsg\":\"invalid token\"}");

        assertThatThrownBy(() -> dispatcher.sendTextMessage("https://example.test/webhook", "busy"))
            .isInstanceOf(IOException.class).hasMessageContaining("40014");
    }

    @Test
    void surfacesHttpFailureToTheFallbackCaller() throws Exception {
        DingtalkReplyDispatcher dispatcher = dispatcher(503, "unavailable");

        assertThatThrownBy(() -> dispatcher.sendTextMessage("https://example.test/webhook", "busy"))
            .isInstanceOf(IOException.class).hasMessageContaining("503");
    }

    @Test
    void acceptsSuccessfulDelivery() throws Exception {
        DingtalkReplyDispatcher dispatcher = dispatcher(200, "{\"errcode\":0}");

        assertThatCode(() -> dispatcher.sendTextMessage("https://example.test/webhook", "busy"))
            .doesNotThrowAnyException();
    }

    private DingtalkReplyDispatcher dispatcher(int status, String body) throws Exception {
        OkHttpClient client = mock(OkHttpClient.class);
        Call call = mock(Call.class);
        DingtalkHttpClientFactory factory = mock(DingtalkHttpClientFactory.class);
        when(factory.webhookClient()).thenReturn(client);
        when(client.newCall(any())).thenReturn(call);
        Response response = new Response.Builder().code(status).message("test").protocol(Protocol.HTTP_1_1)
            .request(new Request.Builder().url("https://example.test/webhook").build())
            .body(ResponseBody.create(body, MediaType.get("application/json"))).build();
        when(call.execute()).thenReturn(response);
        return new DingtalkReplyDispatcher(new ObjectMapper(), factory);
    }
}
