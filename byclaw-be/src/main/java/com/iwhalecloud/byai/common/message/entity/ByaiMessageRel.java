package com.iwhalecloud.byai.common.message.entity;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;
import java.util.List;

/**
 * @author he.duming
 * @date 2026-02-09 13:56:57
 * @description 对应数据库表 byai_message_relobj（全下划线规范）
 */
@Getter
@Setter
public class ByaiMessageRel {

    // 主键
    private Long id;

    // 关联ID
    private Long relId;

    // 企业账号ID
    private Long comAcctId;

    // 提问时间
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date askTime;

    // 提问对象ID
    private Long askObjId;

    // 提问访问终端
    private String askAccessTerminal;

    // 任务耗时
    private Float taskDueTime;

    // 提问消息ID
    private Long askMsgId;

    // 提问对象类型
    private String askObjType;

    // 响应对象类型
    private String resObjType;

    // 响应时间
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date resTime;

    // 响应内容
    private String resContent;

    // 响应对象ID
    private Long resObjId;

    // 创建时间
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    // 响应消息ID
    private Long resMsgId;

    // 响应访问终端
    private String resAccessTerminal;

    // 项目ID
    private Long projectId;

    // 任务ID
    private Long taskId;

    // 请求状态
    private Integer requestStatus;

    // 提问内容
    private String askContent;

    // 提问内容标签
    private String askContentTags;

    // 响应内容标签
    private String resContentTags;

    // 提问内容向量
    private String askContentVector;

    // 响应内容向量
    private String resContentVector;

    /** token 输入token总数 */
    private Float inputTokenCount;

    /** token 输出token总数 */
    private Float outputTokenCount;

    /** token 每秒输出token数 */
    private Float outputTokenPerSecond;

    /** 首字响应时长 */
    private Float firstTextDuration;

    // 反馈类型
    private String feedbackType;

    // 反馈时间
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date feedbackTime;

    // 反馈标签
    private String feedbackLabel;

    // 反馈分数
    private Float feedbackScore;

    // 反馈内容
    private String feedbackContent;

    // 会话ID
    private Long sessionId;

    // ======================= doc 同步字段 =======================
    private String docAskAccessTerminal;
    private String docAskContent;
    private Long docAskMsgId;
    private Long docAskObjId;
    private String docAskObjType;
    private String docAskTime;
    private Long docComAcctId;
    private String docCreateTime;
    private String docFeedbackType;
    private Float docFirstTextDuration;
    private Float docInputTokenCount;
    private Float docOutputTokenCount;
    private Float docOutputTokenPerSecond;
    private Long docProjectId;
    private Long docRequestStatus;
    private String docResAccessTerminal;
    private String docResContent;
    private Long docResMsgId;
    private Long docResObjId;
    private String docResObjType;
    private String docResTime;
    private Long docSessionId;
    private Float docTaskDueTime;
    private Long docTaskId;
}