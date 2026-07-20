package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model;

/**
 * WeCom conversation type (callback {@code body.chattype}).
 * {@code chatid} is only present for {@link #GROUP}.
 */
public enum WecomChatType {

    SINGLE("single"),
    GROUP("group");

    private final String code;

    WecomChatType(String code) {
        this.code = code;
    }

    public String getCode() {
        return code;
    }

    public boolean matches(String chattype) {
        return this.code.equalsIgnoreCase(chattype);
    }

    public static WecomChatType fromCode(String chattype) {
        if (chattype == null) {
            return null;
        }
        for (WecomChatType type : values()) {
            if (type.code.equalsIgnoreCase(chattype)) {
                return type;
            }
        }
        return null;
    }
}
