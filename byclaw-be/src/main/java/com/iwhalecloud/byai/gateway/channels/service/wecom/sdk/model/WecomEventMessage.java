package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.Getter;
import lombok.Setter;

/**
 * Parsed {@code aibot_event_callback} body (reference SDK {@code EventMessage},
 * src/types/event.ts). Bound from the raw {@code body} JsonNode after the
 * envelope is dispatched on {@code cmd == aibot_event_callback}.
 *
 * <p>The event kind is read from {@code event.eventtype} — detect it BEFORE any
 * business binding (esp. {@code disconnected_event}); do not rely on
 * {@code from}/{@code chatid} being present for that event (they are declared
 * optional in the SDK model, not guaranteed absent).
 */
@Getter
@Setter
public class WecomEventMessage {

    /** Callback dedup key ({@code body.msgid}). */
    private String msgId;

    /** Event timestamp ({@code body.create_time}). */
    private Long createTime;

    /** Bot id ({@code body.aibotid}). */
    private String aibotId;

    /** Conversation id — only for group ({@code body.chatid}); may be absent. */
    private String chatId;

    /** single / group ({@code body.chattype}); may be absent for some events. */
    private String chatType;

    /** Event trigger userid ({@code body.from.userid}); may be absent (e.g. disconnected_event). */
    private String fromUserId;

    /** enter_chat / template_card_event / feedback_event / disconnected_event ({@code body.event.eventtype}). */
    private String eventType;

    /** Template-card button key, when present ({@code event.event_key}). */
    private String eventKey;

    /** Template-card task id, when present ({@code event.task_id}); must be echoed on update. */
    private String taskId;

    /** Original callback req_id (needed to reply welcome / card update within 5s). */
    private String reqId;

    /** Raw body kept verbatim for troubleshooting and future compatibility. */
    private JsonNode raw;
}
