package com.iwhalecloud.byai.gateway.channels.service.wecom.stream;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.WecomWsClient;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.WecomReplyDispatcher;

import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomEventMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Handles WeCom {@code aibot_event_callback} events, ported from the reference
 * SDK event routing. Dedup is by {@code body.msgid} in the event namespace;
 * enter_chat welcome and template_card update replies must fire within 5s of
 * the callback (the dispatcher sends via the original event {@code req_id}).
 *
 * <p>{@code disconnected_event} is NOT handled here — the connection-level
 * teardown lives in {@link WecomWsClient} (plan §6.4); by the time an event
 * reaches this service it is a business event, not a takeover signal.
 */
@Service
public class WecomEventService {

    private static final Logger logger = LoggerFactory.getLogger(WecomEventService.class);

    private static final String EVENT_ENTER_CHAT = "enter_chat";
    private static final String EVENT_TEMPLATE_CARD = "template_card_event";
    private static final String EVENT_FEEDBACK = "feedback_event";

    private final WecomDedupService dedupService;

    public WecomEventService(WecomDedupService dedupService) {
        this.dedupService = dedupService;
    }

    /**
     * Route a parsed event. The dispatcher is the per-connection reply
     * dispatcher (bound to the socket that received this event), so welcome /
     * card-update replies go back on the right connection within the 5s window.
     */
    public void handleEvent(WecomEventMessage event, WecomReplyDispatcher dispatcher) {
        String eventType = event.getEventType();
        if (eventType == null) {
            logger.debug("WeCom event without eventtype, ignored. msgId={}", event.getMsgId());
            return;
        }
        if (dedupService.isDuplicateEvent(event.getMsgId())) {
            logger.info("Skip duplicate WeCom event. eventType={}, msgId={}", eventType, event.getMsgId());
            return;
        }

        switch (eventType) {
            case EVENT_ENTER_CHAT -> handleEnterChat(event, dispatcher);
            case EVENT_TEMPLATE_CARD -> handleTemplateCardEvent(event, dispatcher);
            case EVENT_FEEDBACK -> handleFeedback(event);
            default -> logger.debug("Unhandled WeCom event type: {}", eventType);
        }
    }

    /** enter_chat: reply a welcome message within 5s via the event req_id. */
    private void handleEnterChat(WecomEventMessage event, WecomReplyDispatcher dispatcher) {
        // Welcome content is intentionally minimal here; a later milestone can
        // pull a per-bot configured greeting. The 5s window is why this replies
        // synchronously on the callback path rather than deferring to the
        // business executor.
        logger.info("WeCom enter_chat, replying welcome. reqId={}", event.getReqId());
        dispatcher.replyWelcomeText(event.getReqId(), "您好，我是您的智能助手，请问有什么可以帮您？")
                .exceptionally(ex -> {
                    logger.warn("WeCom welcome reply failed. reqId={}", event.getReqId(), ex);
                    return null;
                });
    }

    /** template_card_event: business generates updated card; must reply within 5s. */
    private void handleTemplateCardEvent(WecomEventMessage event, WecomReplyDispatcher dispatcher) {
        // First milestone records the click; card update payload is built by a
        // later interactive-card milestone. taskId must be echoed on the update.
        logger.info("WeCom template_card_event. eventKey={}, taskId={}, reqId={}",
                event.getEventKey(), event.getTaskId(), event.getReqId());
    }

    /** feedback_event: record the user's thumbs up/down. */
    private void handleFeedback(WecomEventMessage event) {
        logger.info("WeCom feedback_event recorded. msgId={}, fromUser present={}",
                event.getMsgId(), event.getFromUserId() != null);
    }
}
