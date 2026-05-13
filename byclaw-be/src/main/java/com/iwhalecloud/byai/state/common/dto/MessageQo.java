package com.iwhalecloud.byai.state.common.dto;

import java.util.List;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class MessageQo extends NexusaiPage {
    /**
     * 会话ID
     */
    private Long sessionId;
    /**
     * 过滤的开始
     */
    private String startDate;
    /**
     * 过滤结束的时间
     */
    private String endDate;
    /**
     * 用途用以过滤系统回答还是用户输入
     */
    private Integer usage;

    private Long fromMessageId;

    private Long messageId;

    private List<Long> messageIds;


    public static MessageQo init(Long sessionId) {
        MessageQo messageQo = new MessageQo();
        messageQo.initPage();
        messageQo.setSessionId(sessionId);
        return messageQo;
    }


    public void initPage() {
        super.init(this);
    }
}
