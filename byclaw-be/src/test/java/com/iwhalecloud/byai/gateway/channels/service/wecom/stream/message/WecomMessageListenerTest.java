package com.iwhalecloud.byai.gateway.channels.service.wecom.stream.message;

import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class WecomMessageListenerTest {

    @Test
    void chatFailureReplyIncludesMsgIdAndBusinessErrorFromCause() {
        Exception error = new BdpRuntimeException("wrapper",
                new BdpRuntimeException("当前会话仍在运行中，请等待完成或停止后再发送"));

        String reply = WecomMessageListener.chatFailureReply(error);

        assertThat(reply).isEqualTo("""
                当前会话仍在运行中，请等待完成或停止后再发送""");
    }
}
