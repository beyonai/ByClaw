package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model;

/**
 * WeCom long-connection message types (from the callback {@code body.msgtype}).
 * Mirrors the reference SDK {@code src/types/message.ts MessageType} plus the
 * {@code event} sentinel used by {@code aibot_event_callback}.
 */
public enum WecomMsgType {

    TEXT("text"),
    IMAGE("image"),
    MIXED("mixed"),
    VOICE("voice"),
    FILE("file"),
    VIDEO("video"),
    /** Event callback body carries msgtype = "event". */
    EVENT("event");

    private final String code;

    WecomMsgType(String code) {
        this.code = code;
    }

    public String getCode() {
        return code;
    }

    public boolean matches(String msgtype) {
        return this.code.equalsIgnoreCase(msgtype);
    }

    public static WecomMsgType fromCode(String msgtype) {
        if (msgtype == null) {
            return null;
        }
        for (WecomMsgType type : values()) {
            if (type.code.equalsIgnoreCase(msgtype)) {
                return type;
            }
        }
        return null;
    }
}
