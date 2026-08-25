package com.iwhalecloud.byai.state.domain.chat.service;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class StreamDispatchResultTest {

    @Test
    void terminalResultCarriesContextForPostAckCleanup() {
        ChatProcessContext context = new ChatProcessContext(null, null);

        StreamDispatchResult result = StreamDispatchResult.terminalHandled(context);

        assertTrue(result.shouldAcknowledge());
        assertTrue(result.isTerminal());
        assertSame(context, result.getContext());
    }
}
