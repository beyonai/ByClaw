package com.iwhalecloud.byai.manager.dto.conversation;

import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;
import java.util.List;

/**
 * 消息索引DTO
 */
@Getter
@Setter
public class Message implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 关联ID
     */
    private Long relId;

    /**
     * 消息任务标识,对应请求终端+"_" + requestID，但要保证唯一
     */
    private Long taskId;

    /**
     * 提问消息标识
     */
    private Long askMsgId;

    /**
     * 提问消息内容
     */
    private String askContent;

    /**
     * 提问消息向量
     */
    private Object askContentVector;

    /**
     * 提问消息标签数组,[''喜欢'', ''不准�?']
     */
    private String askContentTags;

    /**
     * 提问来源终端
     */
    private String askAccessTerminal;

    /**
     * 人员：HUMAN，数字员工：AGETNT，超级助理：SUASS
     */
    private String askObjType;

    /**
     * 提问对象标识
     */
    private Long askObjId;

    /**
     * 提问时间
     */
    private String askTime;

    /**
     * 回复消息标识
     */
    private Long resMsgId;

    /**
     * 回复消息内容
     */
    private String resContent;

    /**
     * 回复消息向量
     */
    private Object resContentVector;

    /**
     * 提问消息标签�?[''喜欢'', ''不准�?']
     */
    private String resContentTags;

    /**
     * 回复来源终端
     */
    private String resAccessTerminal;

    /**
     * 人员：HUMAN，数字员工：AGETNT，超级助理：SUASS
     */
    private String resObjType;

    /**
     * 回复对象标识
     */
    private Long resObjId;

    /**
     * 回复时间
     */
    private String resTime;

    /**
     * 用户反馈类型
     */
    private String feedbackType;

    /**
     * 用户反馈标签，逗号分隔
     */
    private List<String> feedbackLabel;

    /**
     * 用户反馈评分
     */
    private Float feedbackScore;

    /**
     * 用户反馈内容
     */
    private String feedbackContent;

    /**
     * 问答状态，成功�?，失败：-1
     */
    private Integer requestStatus;

    /**
     * 首词响应时长（毫秒）
     */
    private Float firstTextDuration;

    /**
     * 请求耗时(s)
     */
    private Float taskDueTime;

    /**
     * 反馈时间
     */
    private String feedbackTime;

    /**
     * 创建时间
     */
    private String createTime;

    /**
     * 来源渠道
     */
    private Long projectId;

    /**
     * 所属企�?
     */
    private Long comAcctId;

    /**
     * 是否处理
     */
    private Integer isHandle;

    /**
     * 会话id
     */
    private Long sessionId;

}