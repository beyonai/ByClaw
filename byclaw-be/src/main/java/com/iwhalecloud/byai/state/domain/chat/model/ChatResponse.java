package com.iwhalecloud.byai.state.domain.chat.model;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class ChatResponse {
    /**
     * 系统回答的消息ID
     */
    Long messageId;

    /**
     * 会话ID
     */
    Long sessionId;

    /**
     * 用户问题的消息ID
     */
    Long queryMessageId;

    List<ChatRelatedResource> relatedResources;

    /**
     * 推荐问题列表
     */
    List<String> relatedQuestions = new ArrayList<>();

    /**
     * 成果空间
     */
    private ResultSpace resultSpace;

    //关联资源标识
    private String resComIds;
}
