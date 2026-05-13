package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;
import java.io.Serializable;

/**
 * 智能体扩展表实体类
 */
@Data
@TableName("ss_res_ext_agent")
public class SsResExtAgent implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 数字资源标识（主键）
     */
    @TableId
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 智能体类型
     * 001-综合类智能体
     * 002-流程操作类智能体
     * 003-文档问答类智能体
     * 004-数据问答类智能体
     */
    private String agentType;

    /**
     * 对话对接地址
     */
    private String agentSseUrl;

    /**
     * 页面对接地址
     */
    private String agentWebUrl;

    /**
     * 管理页面地址
     */
    private String agentAdminUrl;

    /**
     * 数字员工配置（JSON格式）
     * {
     *   "modelInfo": {
     *     "model": "string",
     *     "modelId": "string",
     *     "history": 6,
     *     "maxToken": 1000,
     *     "temperature": 0.1
     *   },
     *   "descText": "string",
     *   "greeting": "string"
     * }
     */
    private String prologue;

    /**
     * 服务对接原始地址
     */
    private String agentSseUrlOri;

    /**
     * 页面对接原始地址
     */
    private String agentWebUrlOri;

    /**
     * 管理页面原始地址
     */
    private String agentAdminUrlOri;

    /**
     * 智能体开发类型
     */
    private String agentDevType;

    /**
     * 服务对接地址头信息
     */
    private String agentSseHead;

    /**
     * 认证方式
     * session/oauth2
     */
    private String authType;

    /**
     * 集成类型，用于标识数字员工的集成方式,A2A:a2a协议， INTERFACE：sse接口集成
     */
    private String integrationType;

    /**
     * 原始 JSON 内容
     */
    private String sourceContent;

    /**
     * 增加 resourceId 首节点后的 JSON 内容
     */
    private String targetContent;

}
