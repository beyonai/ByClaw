package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model;

public enum DingtalkMsgType {

    TEXT("text"),
    RICH_TEXT("richText"),
    PICTURE("picture"),
    AUDIO("audio"),
    VIDEO("video"),
    FILE("file"),
    INTERACTIVE_CARD("interactiveCard");

    private final String code;

    DingtalkMsgType(String code) {
        this.code = code;
    }

    public String getCode() {
        return code;
    }

    public boolean matches(String msgtype) {
        return this.code.equalsIgnoreCase(msgtype);
    }
}
