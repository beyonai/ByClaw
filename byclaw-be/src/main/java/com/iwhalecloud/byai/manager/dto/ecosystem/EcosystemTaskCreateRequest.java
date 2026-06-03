package com.iwhalecloud.byai.manager.dto.ecosystem;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

/**
 * 生态采集任务创建请求。
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
@Data
public class EcosystemTaskCreateRequest {

    /**
     * 采集任务名称，未传时按连接器名称生成默认名称。
     */
    private String taskName;

    /**
     * 连接器编码，例如 web、zhihu、github、mail。
     */
    private String connectorCode;

    /**
     * 已保存的连接配置 ID，用于复用 Token、OAuth、IMAP 或浏览器登录态配置。
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long connectionId;

    /**
     * 采集入口地址，例如网页链接、知乎问题/收藏夹链接。
     */
    private String sourceUrl;

    /**
     * 采集范围描述，例如最近 7 天、收藏夹、单篇链接。
     */
    private String scope;

    /**
     * 知识归属类型，P0 默认 personal，后续可扩展 enterprise。
     */
    private String ownerType;

    /**
     * 运行位置，LOCAL 表示用户浏览器桥接侧，SERVER 表示平台侧执行。
     */
    private String runLocation;

    /**
     * 采集模式，例如 SERVER_OPENCLI、USER_BROWSER_BRIDGE。
     */
    private String collectMode;

    /**
     * 调度类型，例如 once、manual、daily、weekly。
     */
    private String scheduleType;

    /**
     * 调度配置，保存执行小时、星期、时区、下次运行时间等扩展参数。
     */
    private Map<String, Object> scheduleConfig;

    /**
     * 入库目标类型，当前真实入库只支持 knowledgeBase。
     */
    private String importTarget;

    /**
     * 知识库所属目录 ID。
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long catalogId;

    /**
     * 前端兼容用知识库 ID 字符串。
     */
    private String knowledgeBaseId;

    /**
     * 知识库资源 ID，真实入库时传给 DatasetApplicationService。
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long knowledgeBaseResourceId;

    /**
     * 知识库展示名称，用于任务目标和采集结果展示。
     */
    private String knowledgeBaseName;

    /**
     * 业务对象信号：项目。
     */
    private String project;

    /**
     * 业务对象信号：产品。
     */
    private String product;

    /**
     * 业务对象信号：客户。
     */
    private String customer;

    /**
     * 业务对象信号：领域。
     */
    private String domain;

    /**
     * 用户补充的主题标签信号。
     */
    private List<String> signalTags;

    /**
     * 扩展选项，例如聊天入口上下文、是否保存原始产物等。
     */
    private Map<String, Object> options;
}
