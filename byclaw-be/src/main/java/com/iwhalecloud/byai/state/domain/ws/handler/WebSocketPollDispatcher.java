package com.iwhalecloud.byai.state.domain.ws.handler;

import java.util.concurrent.RejectedExecutionException;

import io.netty.channel.Channel;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Independent bounded admission for periodic work; newer ticks never queue behind an active poll. */
@Component
public class WebSocketPollDispatcher {
    private final WebSocketChatDispatcher dispatcher;

    public WebSocketPollDispatcher() {
        this(64);
    }

    @Autowired
    public WebSocketPollDispatcher(@Value("${byclaw.websocket.poll.max-outstanding:64}") int maxOutstanding) {
        dispatcher = new WebSocketChatDispatcher(maxOutstanding, 1);
    }

    public boolean submit(Channel channel, Runnable action) {
        try {
            dispatcher.submit(channel, action);
            return true;
        }
        catch (RejectedExecutionException coalesced) {
            // Periodic work is refreshed by the next tick; retaining every tick would grow a backlog.
            return false;
        }
    }

    public void closeChannel(Channel channel) {
        dispatcher.closeChannel(channel);
    }

    @PreDestroy
    public void shutdown() {
        dispatcher.shutdown();
    }
}
