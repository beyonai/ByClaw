package com.iwhalecloud.byai.manager.dto.conversation;

import java.util.Date;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class MessageDto {
    /**
     * relId
     */
    private Long relId;

    /**
     * 来源渠道
     */
    private Integer projectId;

    /**
     * 会话id
     */
    private String sessionId;

    /**
     * 渠道名称
     */
    private String projectName;

    /**
     * 来源终端
     */
    private String accessTerminal;

    /**
     * 用户提问
     */
    private String userQuestion;

    /**
     * 系统回答
     */
    private String systemAnswer;

    /**
     * 回复消息的对象，AGENT/ASSISTANT
     */
    private String responseObj;

    /**
     * 创建时间
     */
    private String createTime;

    /**
     * 对话用户
     */
    private String userName;

    /**
     * 用户反馈标签列表
     */
    private List<String> feedbackLabels;

    /**
     * 用户反馈类型
     */
    private String feedbackType;

    /**
     * 用户反馈评分
     */
    private Float feedbackScore;

    /**
     * 用户反馈内容
     */
    private String feedbackContent;

    /**
     * 提问消息id
     */
    private String askMsgId;

    /**
     * 回复消息Id
     */
    private String resMsgId;

    /**
     * 首词响应时长
     */
    private Float firstTextDuration;

    /**
     * 聊天耗时
     */
    private Float taskDueTime;

    /**
     * 请求状态：0成功，1失败
     */
    private Integer requestStatus;

    /**
     * 反馈是否处理：0未处理，1已处理
     */
    private Integer isHandle;

    /**
     * 反馈处理人
     */
    private String handleUser;

    /**
     * 反馈处理时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date handleTime;

    /**
     * 反馈是否已指派 0未指派 1已指派
     */
    private Integer isAssign;

    /**
     * 反馈指派人
     */
    private String assignUser;

}
