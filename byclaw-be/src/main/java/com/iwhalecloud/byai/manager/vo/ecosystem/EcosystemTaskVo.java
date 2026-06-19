package com.iwhalecloud.byai.manager.vo.ecosystem;

import java.util.Date;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

/**
 * 生态采集任务视图。
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
@Data
public class EcosystemTaskVo {

    /**
     * 采集任务 ID。
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long taskId;

    /**
     * 采集任务展示名称。
     */
    private String taskName;

    /**
     * 连接器编码。
     */
    private String connectorCode;

    /**
     * 连接配置 ID。
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long connectionId;

    /**
     * 连接配置展示名称。
     */
    private String connectionName;

    /**
     * 连接配置状态。
     */
    private String connectionStatus;

    /**
     * 认证方式。
     */
    private String authType;

    /**
     * 连接配置最近检测时间。
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date lastCheckTime;

    /**
     * 来源展示名称。
     */
    private String sourceName;

    /**
     * 采集入口地址。
     */
    private String sourceUrl;

    /**
     * 采集范围描述。
     */
    private String scope;

    /**
     * 知识归属类型，当前默认 personal。
     */
    private String ownerType;

    /**
     * 运行位置，LOCAL / SERVER。
     */
    private String runLocation;

    /**
     * 采集模式，例如 SERVER_OPENCLI、USER_BROWSER_BRIDGE。
     */
    private String collectMode;

    /**
     * 调度类型。
     */
    private String scheduleType;

    /**
     * 调度类型展示名称。
     */
    private String scheduleTypeName;

    /**
     * 调度扩展配置。
     */
    private Map<String, Object> scheduleConfig;

    /**
     * 任务扩展选项，包含 collectMode、连接 runtimeConfig、聊天/插件入口上下文等。
     */
    private Map<String, Object> options;

    /**
     * 下次计划运行时间。
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date nextRunTime;

    /**
     * 最近一次定时触发时间。
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date lastScheduledRunTime;

    /**
     * 入库目标类型。
     */
    private String importTarget;

    /**
     * 入库目标展示名称。
     */
    private String targetName;

    /**
     * 知识库目录 ID。
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long catalogId;

    /**
     * 前端兼容用知识库 ID 字符串。
     */
    private String knowledgeBaseId;

    /**
     * 知识库资源 ID。
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long knowledgeBaseResourceId;

    /**
     * 知识库名称。
     */
    private String knowledgeBaseName;

    /**
     * 任务状态。
     */
    private String status;

    /**
     * 任务创建时间。
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    /**
     * 最近一次运行 ID。
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long lastRunId;

    /**
     * 最近一次运行状态编码。
     */
    private String lastRunStatus;

    /**
     * 最近一次运行状态展示名称。
     */
    private String lastRunStatusName;

    /**
     * 最近一次运行时间。
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date lastRunTime;

    /**
     * 最近一次运行生成的 Markdown 数量。
     */
    private Integer lastMarkdownCount;

    /**
     * 最近一次运行失败数量。
     */
    private Integer lastFailedCount;

}
