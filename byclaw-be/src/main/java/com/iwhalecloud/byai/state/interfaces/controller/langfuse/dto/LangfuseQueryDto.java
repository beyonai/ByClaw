package com.iwhalecloud.byai.state.interfaces.controller.langfuse.dto;

import lombok.Data;
import java.time.LocalDateTime;

/**
 * Langfuse查询参数数据传输对象
 */
@Data
public class LangfuseQueryDto {

    /**
     * 页码
     */
    private Integer page = 1;

    /**
     * 每页大小
     */
    private Integer limit = 20;

    /**
     * 用户ID
     */
    private String userId;

    /**
     * 会话ID
     */
    private String sessionId;

    /**
     * 消息ID
     */
    private String resMsgId;

    /**
     * Trace ID
     */
    private String traceId;

    /**
     * Trace名称
     */
    private String name;

    /**
     * Observation类型
     */
    private String type;

    /**
     * 开始时间
     */
    private LocalDateTime startTime;

    /**
     * 结束时间
     */
    private LocalDateTime endTime;

    /**
     * 状态
     */
    private String status;

    /**
     * 环境
     */
    private String environment;

    /**
     * 外部ID
     */
    private String externalId;

    /**
     * 标签
     */
    private String tags;

    /**
     * 排序字段
     */
    private String sortBy = "startTime";

    /**
     * 排序方向 (asc/desc)
     */
    private String sortOrder = "desc";
}
