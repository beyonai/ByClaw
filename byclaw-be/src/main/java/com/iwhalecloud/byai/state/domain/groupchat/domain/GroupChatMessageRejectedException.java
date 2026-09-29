package com.iwhalecloud.byai.state.domain.groupchat.domain;

/** 明确的群消息业务校验失败；message 是可以直接展示给发送者的具体原因。 */
public class GroupChatMessageRejectedException extends IllegalArgumentException {
    public GroupChatMessageRejectedException(String message) {
        super(message);
    }

    public GroupChatMessageRejectedException(String message, Throwable cause) {
        super(message, cause);
    }
}
