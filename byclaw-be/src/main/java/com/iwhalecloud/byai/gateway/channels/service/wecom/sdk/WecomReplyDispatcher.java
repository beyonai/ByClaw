package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomWsFrame;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.CompletableFuture;

/**
 * Builds WeCom reply payloads and sends them through a {@link WecomReplyQueue}
 * so all frames for a given {@code req_id} are serialized behind their ACKs.
 * Ports the payload builders from the reference SDK {@code src/client.ts}.
 *
 * <p>One dispatcher instance is bound to one connection's reply queue. The
 * queue's sender is the connection's {@code sendRaw}.
 */
public class WecomReplyDispatcher {

    private static final Logger logger = LoggerFactory.getLogger(WecomReplyDispatcher.class);

    private final ObjectMapper objectMapper;
    private final WecomReplyQueue replyQueue;

    public WecomReplyDispatcher(ObjectMapper objectMapper, WecomReplyQueue replyQueue) {
        this.objectMapper = objectMapper;
        this.replyQueue = replyQueue;
    }

    /** Cumulative-content streaming reply (aibot_respond_msg, msgtype=stream). */
    public CompletableFuture<WecomWsFrame> replyStream(
            String reqId, String streamId, String content, boolean finish) {
        String streamContent = content == null ? "" : content;
        ObjectNode frame = baseFrame(WecomWsCmd.RESPONSE, reqId);
        ObjectNode body = frame.putObject("body");
        body.put("msgtype", "stream");
        ObjectNode stream = body.putObject("stream");
        stream.put("id", streamId);
        stream.put("finish", finish);
        stream.put("content", streamContent);
        logger.info("WeCom reply stream content. reqId={}, streamId={}, finish={}, content={}",
                reqId, streamId, finish, streamContent);
        return enqueue(reqId, frame);
    }

    /**
     * Plain text reply for a message callback (aibot_respond_msg). WeCom's
     * aibot_respond_msg does NOT support msgtype=text — its supported reply
     * types are stream / template_card / markdown / file / voice / image /
     * video (msgtype=text is only valid for aibot_respond_welcome_msg). Sending
     * msgtype=text here is silently dropped by WeCom, so listener-level notices
     * (no-account / no-auth / busy / fallback) never reached the user. Send them
     * as markdown, which renders plain text fine.
     */
    public CompletableFuture<WecomWsFrame> replyText(String reqId, String content) {
        ObjectNode frame = baseFrame(WecomWsCmd.RESPONSE, reqId);
        ObjectNode body = frame.putObject("body");
        body.put("msgtype", "markdown");
        body.putObject("markdown").put("content", content == null ? "" : content);
        // Notice replies (no-account / no-auth / busy / fallback) are the only
        // feedback the user gets when a chat cannot proceed. Callers fire them
        // and forget the future, so log any ACK error/timeout here rather than
        // letting a failed delivery vanish silently (the root cause that hid the
        // original msgtype=text bug).
        return enqueue(reqId, frame).whenComplete((ack, ex) -> {
            if (ex != null) {
                logger.warn("WeCom notice reply delivery failed. reqId={}", reqId, ex);
            }
        });
    }

    /** Welcome text reply for enter_chat (aibot_respond_welcome_msg). Must fire within 5s. */
    public CompletableFuture<WecomWsFrame> replyWelcomeText(String reqId, String content) {
        ObjectNode frame = baseFrame(WecomWsCmd.RESPONSE_WELCOME, reqId);
        ObjectNode body = frame.putObject("body");
        body.put("msgtype", "text");
        body.putObject("text").put("content", content == null ? "" : content);
        return enqueue(reqId, frame);
    }

    /**
     * Update a template card (aibot_respond_update_msg). Must fire within 5s of
     * the template_card_event; the card's task_id must match the callback.
     */
    public CompletableFuture<WecomWsFrame> updateTemplateCard(String reqId, ObjectNode templateCard) {
        ObjectNode frame = baseFrame(WecomWsCmd.RESPONSE_UPDATE, reqId);
        ObjectNode body = frame.putObject("body");
        body.put("response_type", "update_template_card");
        body.set("template_card", templateCard);
        return enqueue(reqId, frame);
    }

    /** Proactive text push to a conversation (aibot_send_msg). Uses a fresh req_id. */
    public CompletableFuture<WecomWsFrame> sendProactiveMarkdown(String chatId, String content) {
        String reqId = WecomWsClient.generateReqId(WecomWsCmd.SEND_MSG);
        ObjectNode frame = baseFrame(WecomWsCmd.SEND_MSG, reqId);
        ObjectNode body = frame.putObject("body");
        body.put("chatid", chatId);
        body.put("msgtype", "markdown");
        body.putObject("markdown").put("content", content == null ? "" : content);
        return enqueue(reqId, frame);
    }

    /** True when a send for this req_id is awaiting ACK (stream skip-if-pending). */
    public boolean hasPendingAck(String reqId) {
        return replyQueue.hasPendingAck(reqId);
    }

    private ObjectNode baseFrame(String cmd, String reqId) {
        ObjectNode frame = objectMapper.createObjectNode();
        frame.put("cmd", cmd);
        frame.putObject("headers").put("req_id", reqId);
        return frame;
    }

    private CompletableFuture<WecomWsFrame> enqueue(String reqId, ObjectNode frame) {
        return replyQueue.send(reqId, frame.toString());
    }
}
