package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class DingtalkCallbackMessage {

    private String msgId;
    private String sessionWebhook;
    private String conversationType;
    private String conversationId;
    private String senderStaffId;
    private String robotCode;
    private String msgtype;
    private String textContent;
    private Object content;
}
