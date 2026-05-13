package com.iwhalecloud.byai.common.feign.request.manager;

import java.util.List;
import com.iwhalecloud.byai.common.feign.request.conversation.RunConfig;
import com.iwhalecloud.byai.common.feign.request.python.CoreCompetency;
import com.iwhalecloud.byai.common.feign.response.knowledge.FileUploadConfig;
import lombok.Getter;
import lombok.Setter;

/**
 * @author zht
 * @version 1.0
 * @date 2025/7/10
 */
@Getter
@Setter
public class AgentResourceChatInfoDto {

    /**
     * 资源ID，唯一标识数字员工。
     */
    private Long id;

    /**
     * 编码
     */
    private String code;

    /**
     * FROM_MANUALLY:本地; FROM_THIRD:第三方
     */
    private String createType;

    /**
     * 来源系统 BYAI：百应，WHAGE_AGENT:老智能体，BOT：博特，DIFY：DIFY
     */
    private String systemCode;

    /**
     * 集成方式：默认为NONE,可选：PAGE:页面集成、INTERFACE:接口集成
     */
    private String integrationType;

    /**
     * 外部智能体的调用地址
     */
    private String agentSseUrl;

    /**
     * 首页地址
     */
    private String agentHomeUrl;

    /**
     * 数字员工类型。
     */
    private String type;

    /**
     * 数字员工名称。
     */
    private String name;

    /**
     * 数字员工简介。
     */
    private String intro;

    /**
     * 数字员工使用说明。
     */
    private String instructions;

    /**
     * 开场白:您好，请问有什么可以帮助您？
     */
    private String descText;

    /**
     * 人设描述:
     */
    private String role;

    /**
     * 背景:
     */
    private String background;

    /**
     * 开场引导问题:
     */
    private String openingQuestion;

    /**
     * 数字员工头像URL。
     */
    private String avatar;

    /**
     * 关联的智能体
     */
    private List<Agent> agentList;

    /**
     * 关联的数据库ID列表。
     */
    private List<String> databaseIdList;

    /**
     * 关联的知识库列表。
     */
    private List<Dataset> datasetList;

    /**
     * 关联的插件工具OpenAPI信息列表。
     */
    private List<OpenAiToolDto> plugTools;

    /**
     * 关联的MCP服务列表。
     */
    private List<McpServer> mcpServerList;

    /**
     * 核心能力
     */
    private List<CoreCompetency> coreCompetencies;

    /**
     * 运行配置。
     */
    private RunConfig runConfig;

    /**
     * 文件上传相关配置
     */
    private FileUploadConfig fileUpload;

}
