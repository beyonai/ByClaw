package com.iwhalecloud.byai.state.domain.chat.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TraceIdCodecTest {

    @Test
    void encodeShouldPackTwoLongsAsThirtyTwoLowercaseHex() {
        String traceId = TraceIdCodec.encode(100L, 5001L);

        assertThat(traceId).matches("^[0-9a-f]{32}$");
        assertThat(traceId).isNotEqualTo("00000000000000640000000000001389");

        TraceIdCodec.TraceMessageIds messageIds = TraceIdCodec.decode(traceId);
        assertThat(messageIds.getUserMessageId()).isEqualTo(100L);
        assertThat(messageIds.getModelAnswerMessageId()).isEqualTo(5001L);
    }

    @Test
    void decodeShouldSupportLegacyTraceId() {
        TraceIdCodec.TraceMessageIds messageIds = TraceIdCodec.decode("100_5001");

        assertThat(messageIds.getUserMessageId()).isEqualTo(100L);
        assertThat(messageIds.getModelAnswerMessageId()).isEqualTo(5001L);
    }

    @Test
    void decodeShouldRejectInvalidTraceId() {
        assertThat(TraceIdCodec.canDecode("not-a-trace")).isFalse();
        assertThatThrownBy(() -> TraceIdCodec.decode("not-a-trace")).isInstanceOf(IllegalArgumentException.class);
    }
}
