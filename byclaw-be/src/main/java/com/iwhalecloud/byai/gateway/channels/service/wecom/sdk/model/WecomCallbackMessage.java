package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.Getter;
import lombok.Setter;

/**
 * Parsed {@code aibot_msg_callback} body (reference SDK {@code BaseMessage},
 * src/types/message.ts). Bound from the raw {@code body} JsonNode after the
 * envelope is parsed and dispatched on {@code cmd} (see {@link WecomWsFrame}).
 *
 * <p>Text lives in {@code text.content}; image/file/video carry {@code url} +
 * {@code aeskey} (5-min TTL, AES-256-CBC, see plan §6.7); voice carries
 * transcribed {@code voice.content}. The raw body is retained for
 * troubleshooting and forward-compatibility.
 */
@Getter
@Setter
public class WecomCallbackMessage {

    /** Callback dedup key ({@code body.msgid}). */
    private String msgId;

    /** Bot id ({@code body.aibotid}). */
    private String aibotId;

    /** Conversation id — only present for group chats ({@code body.chatid}). */
    private String chatId;

    /** single / group ({@code body.chattype}). */
    private String chatType;

    /** Sender userid ({@code body.from.userid}) — may be plaintext or encrypted. */
    private String fromUserId;

    /** text / image / mixed / voice / file / video ({@code body.msgtype}). */
    private String msgType;

    /** Original callback req_id, echoed back on every reply frame. */
    private String reqId;

    /**
     * Temporary URL for proactively replying to this message over HTTP
     * ({@code body.response_url}). Present on message callbacks (absent on the
     * stream-refresh callback). The long-connection reply path answers over the
     * socket via {@code req_id}, so this is retained for the HTTP fallback /
     * out-of-band proactive replies rather than used on the main chain.
     */
    private String responseUrl;

    /** Event timestamp ({@code body.create_time}). */
    private Long createTime;

    /** Extracted plain text (text.content or voice.content); null for pure media. */
    private String textContent;

    /** Media download url (image/file/video); short-lived, never logged. */
    private String mediaUrl;

    /** Media AES key (base64); never logged. */
    private String mediaAesKey;

    /** Raw body kept verbatim for troubleshooting and future compatibility. */
    private JsonNode raw;
}
