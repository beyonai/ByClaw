package com.iwhalecloud.byai.gateway.channels.service.feishu.model;

public enum FeishuMsgType {

    TEXT("text"),
    POST("post"),
    IMAGE("image"),
    FILE("file"),
    AUDIO("audio"),
    MEDIA("media"),
    STICKER("sticker");

    private final String code;

    FeishuMsgType(String code) {
        this.code = code;
    }

    public String getCode() {
        return code;
    }

    public boolean matches(String msgType) {
        return this.code.equalsIgnoreCase(msgType);
    }
}
