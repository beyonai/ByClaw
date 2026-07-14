package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.listener;

import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.cards.DingtalkCardStreamingOutputStream;
import org.junit.jupiter.api.Test;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DingtalkBotListenerTest {

    @Test
    void awaitStreamCompletionShouldFinalizeAccumulatedContentAfterIdleTimeout() throws Exception {
        DingtalkCardStreamingOutputStream outputStream = mock(DingtalkCardStreamingOutputStream.class);
        doThrow(new TimeoutException("idle"))
                .when(outputStream).awaitCompletionAfterIdle(60, TimeUnit.SECONDS);
        when(outputStream.hasStreamingFailed()).thenReturn(false);

        boolean completed = DingtalkBotListener.awaitStreamCompletion(outputStream);

        assertThat(completed).isTrue();
        verify(outputStream).finish();
    }

    @Test
    void awaitStreamCompletionShouldFailWhenAppStreamCompletionFails() throws Exception {
        DingtalkCardStreamingOutputStream outputStream = mock(DingtalkCardStreamingOutputStream.class);
        doThrow(new IllegalStateException("finalize failed"))
                .when(outputStream).awaitCompletionAfterIdle(60, TimeUnit.SECONDS);

        assertThat(DingtalkBotListener.awaitStreamCompletion(outputStream)).isFalse();
    }
}
