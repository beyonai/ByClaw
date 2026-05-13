package com.iwhalecloud.byai.common.message.dto;

import lombok.Data;

import java.io.Serializable;
import java.util.Date;

/**
 * 元数据检索响应DTO
 */
@Data
public class MemSearchResponseDTO implements Serializable {
    
    private static final long serialVersionUID = 1L;
    
    /**
     * 消息标识
     */
    private Long messageId;
    
    /**
     * 消息原文
     * 用户输入原始内容，需要支持ES关键字检索
     */
    private String messageContent;
    
    /**
     * 消息结构体
     * 存储伟童定义的各类消息结构体，用户对话前端展示，例如文字+柱状图，【开心】=》表情图标
     */
    private String messageStruct;
    
    /**
     * 用途
     * 1：用户输入
     * 2：系统回答
     * 3：输入感知
     * 4：系统追问
     * 5：系统思考
     * 6：记忆总结
     */
    private Integer usage;
    
    /**
     * 消息引用
     * source_id，表明这个消息是引用具体的消息标识
     */
    private Long messageRef;
    
    /**
     * 所属日期
     * 用于做冷热数据，按天分区
     */
    private Date belongDate;
    
    /**
     * 创建时间
     */
    private Date createTime;
    
    /**
     * 创建人员
     * 当前登录人员标识
     */
    private Long creatorId;

    /**
     * 推理日志
     */
    private String inferLog;

    /**
     * 所属会话标识
     */
    private Long sessionId;
    
    /**
     * 所属企业
     * 当前登录企业标识
     */
    private Long enterpriseId;
    
    /**
     * 元数据标签 标签列表
     */
    private String metadata;
    
    /**
     * 消息关联资源
     * 以JSON文本形式存储关联资源信息
     */
    private String relatedResources;
    
    /**
     * 调用日志
     * 以JSON文本形式存储调用日志信息
     */
    private String callLogs;
    
    /**
     * 搜索相关性分数
     */
    private Float score;
    
    /**
     * 消息角色
     * agent-user、assistant-user、agent-assistant、user-agent、user-assistant、assistant-agent
     */
    private String role;
    
    /**
     * 项目标识
     * 消息所属项目
     */
    private Long projectId;
    
    /**
     * 访问终端
     * 访问终端类型标识
     */
    private String accessTerminal;
    
    /**
     * 任务标识
     * 消息关联的任务ID
     */
    private Long taskId;
    
    /**
     * 关联对象
     * 消息关联的其他对象信息，以JSON格式存储
     */
    private String relObjs;

    /**
     * 反馈评分
     */
    private String feedbackScore;

    /**
     * 反馈标签
     */
    private String feedbackLabel;
} 