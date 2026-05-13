package com.iwhalecloud.byai.state.domain.message.model;

import java.util.List;
import java.util.Set;

import jakarta.validation.constraints.NotNull;
import lombok.Data;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;

@Data
public class GroupChatVo {
    @NotNull(message = "sessionId is not null")
    private Long sessionId;
    /**
     * 问题中的附件
     */
    private List<MessageFileDto> files;
    /**
     * 用户输入
     */
    @NotNull(message = "chatContent is not null")
    private String chatContent;
    /**
     * 艾特的名单
     */
    private Set<Long> mentionUserIds;

    /**
     * 创建人
     */
    private Long createId;

    /**
     * 任务id
     */
    private Long taskId;

    /**
     * 消息用法
     * 1, "用户输入"
     * 2, "系统回答"
     * 3, "系统追问"
     */
    private Integer usage;

    /**
     * 关联资源标识
     */
    private String resComIds;

    /**
     * 消息状态
     * 0:结束
     * 1：追加
     */
    private Integer msgStatus;

    /**
     * 调用日志
     * 以JSON文本形式存储调用日志信息，替代/补充log字段
     */
    private String callLogs;

    /**
     * 推理日志
     */
    private String inferLog;

    /**
     * 消息结构
     */
    private String messageStruct;
}
