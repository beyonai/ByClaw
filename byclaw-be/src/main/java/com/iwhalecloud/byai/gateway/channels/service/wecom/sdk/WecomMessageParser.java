package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk;

import com.fasterxml.jackson.databind.JsonNode;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomEventMessage;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomMsgType;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomWsFrame;
import org.springframework.stereotype.Service;

/**
 * Second stage of the two-stage parse (plan §Task 2): the envelope is already
 * parsed into {@link WecomWsFrame} with {@code body} as a raw {@link JsonNode};
 * this binds that body to a concrete {@link WecomCallbackMessage} /
 * {@link WecomEventMessage} by {@code msgtype} / {@code event.eventtype}.
 *
 * <p>Media {@code url}/{@code aeskey} are extracted verbatim but never logged.
 */
@Service
public class WecomMessageParser {

    /** Parse an aibot_msg_callback frame body. */
    public WecomCallbackMessage parseCallback(WecomWsFrame frame) {
        JsonNode body = frame.getBody();
        WecomCallbackMessage msg = new WecomCallbackMessage();
        msg.setReqId(frame.reqId());
        if (body == null) {
            return msg;
        }
        msg.setRaw(body);
        msg.setMsgId(text(body, "msgid"));
        msg.setAibotId(text(body, "aibotid"));
        msg.setChatId(text(body, "chatid"));
        msg.setChatType(text(body, "chattype"));
        msg.setFromUserId(body.path("from").path("userid").asText(null));
        msg.setResponseUrl(text(body, "response_url"));
        String msgType = text(body, "msgtype");
        msg.setMsgType(msgType);
        Long createTime = body.has("create_time") ? body.path("create_time").asLong() : null;
        msg.setCreateTime(createTime);

        WecomMsgType type = WecomMsgType.fromCode(msgType);
        if (type == null) {
            return msg;
        }
        switch (type) {
            case TEXT -> msg.setTextContent(body.path("text").path("content").asText(null));
            case VOICE -> msg.setTextContent(body.path("voice").path("content").asText(null));
            case IMAGE -> bindMedia(msg, body.path("image"));
            case FILE -> bindMedia(msg, body.path("file"));
            case VIDEO -> bindMedia(msg, body.path("video"));
            case MIXED -> {
                msg.setTextContent(extractMixedText(body.path("mixed")));
                bindMixedMedia(msg, body.path("mixed"));
            }
            default -> {
                // event / unknown: leave content null
            }
        }
        return msg;
    }

    /** Parse an aibot_event_callback frame body. */
    public WecomEventMessage parseEvent(WecomWsFrame frame) {
        JsonNode body = frame.getBody();
        WecomEventMessage evt = new WecomEventMessage();
        evt.setReqId(frame.reqId());
        if (body == null) {
            return evt;
        }
        evt.setRaw(body);
        evt.setMsgId(text(body, "msgid"));
        evt.setAibotId(text(body, "aibotid"));
        evt.setChatId(text(body, "chatid"));
        evt.setChatType(text(body, "chattype"));
        evt.setFromUserId(body.path("from").path("userid").asText(null));
        Long createTime = body.has("create_time") ? body.path("create_time").asLong() : null;
        evt.setCreateTime(createTime);
        JsonNode event = body.path("event");
        evt.setEventType(event.path("eventtype").asText(null));
        evt.setEventKey(event.path("event_key").asText(null));
        evt.setTaskId(event.path("task_id").asText(null));
        return evt;
    }

    private void bindMedia(WecomCallbackMessage msg, JsonNode media) {
        if (media == null || media.isMissingNode()) {
            return;
        }
        msg.setMediaUrl(media.path("url").asText(null));
        msg.setMediaAesKey(media.path("aeskey").asText(null));
    }

    /**
     * Bind the first image item's url+aeskey from a mixed message so image
     * content is not silently dropped (WeCom mixed.msg_item items are
     * {@code msgtype: text | image}). First milestone handles a single image;
     * multi-image mixed can be extended later.
     */
    private void bindMixedMedia(WecomCallbackMessage msg, JsonNode mixed) {
        JsonNode items = mixed.path("msg_item");
        if (!items.isArray()) {
            return;
        }
        for (JsonNode item : items) {
            if ("image".equals(item.path("msgtype").asText(null))) {
                JsonNode image = item.path("image");
                String url = image.path("url").asText(null);
                if (url != null && !url.isBlank()) {
                    msg.setMediaUrl(url);
                    msg.setMediaAesKey(image.path("aeskey").asText(null));
                    return; // first image only in the first milestone
                }
            }
        }
    }

    private String extractMixedText(JsonNode mixed) {
        JsonNode items = mixed.path("msg_item");
        if (!items.isArray()) {
            return null;
        }
        StringBuilder sb = new StringBuilder();
        for (JsonNode item : items) {
            if ("text".equals(item.path("msgtype").asText(null))) {
                String t = item.path("text").path("content").asText(null);
                if (t != null && !t.isBlank()) {
                    if (sb.length() > 0) {
                        sb.append('\n');
                    }
                    sb.append(t);
                }
            }
        }
        return sb.length() == 0 ? null : sb.toString();
    }

    private String text(JsonNode node, String field) {
        return node.path(field).asText(null);
    }
}
