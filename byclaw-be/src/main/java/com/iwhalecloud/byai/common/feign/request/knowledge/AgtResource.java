package com.iwhalecloud.byai.common.feign.request.knowledge;

import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import com.iwhalecloud.byai.common.feign.response.knowledge.PluginHeader;
import com.iwhalecloud.byai.common.feign.response.knowledge.Priviledge;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-04-17 14:12:32
 * @description 知识库实体一
 * @description 智能体实体一
 */
@Getter
@Setter
public class AgtResource {

    /**
     * 资源id，资源的唯一标识,编辑时传
     */
    private String resourceId;

    /**
     * 本地知识库:dataset,第三方知识库:external
     */
    private String type;

    /**
     * 插件标识
     */
    private Long pluginMachineId;

    /**
     * topic标识
     */
    private String kdbId;

    /**
     * 文件类别 1.文档 2.表格 3.图片 4.综合
     */
    @NotBlank(groups = {
        Add.class, Mod.class
    }, message = "{agtresource.filetype.notblank}")
    @Pattern(groups = {
        Add.class, Mod.class
    }, regexp = "4", message = "{agtresource.filetype.pattern}")
    private String fileGroup;

    /**
     * 知识库名称
     */
    private String datasetName;

    /**
     * 知识库描述 或者是智能体的描述
     */
    private String intro;

    /**
     * 向量数据库编码如es，智能体运维人员根据实际情况提供
     */
    private String vectorDbCode;

    /**
     * 向量模型编码，智能体运维人员根据实际情况提供
     */
    private String vectorPluginMachineId;

    // 动态记录编码
    private String dynamicRecordCode;

    // 动态记录名称
    private String dynamicRecordName;

    // 动态记录状态
    private String dynamicRecordStatus;

    // 动态记录描述
    private String dynamicRecordDesc;

    // 数据源ID
    private Integer datasourceId;


    /**
     * 知识库名称 智能体名称
     */
    @Size(groups = {
        Add.class, Mod.class
    }, max = 50, message = "{agtresource.name.size}")
    private String resourceName;

    /**
     * 资源状态
     */
    private String queryStatus;

    /**
     * 资源类型， 知识库为2
     */
    @NotBlank(message = "{agtresource.type.notblank}")
    private String queryResourceType;

    /**
     * 资源类型，1智能体，2文档库
     */
    @NotBlank(message = "{agtresource.type.notblank}")
    private String resourceType;

    /**
     * 项目id (与账号绑定，由智能体运维人员配置好提供),百应的默认值为-1000
     */
    private Long resourceProjectId = -1000L;

    /**
     * 知识库id 同objld
     */
    private Long datasetId;

    /**
     * 对象id (操作的是知识库的情况下此字段就是知识库id)
     */
    private Long objId;

    /**
     * TODO:目前默认1
     */
    private String appType;

    /**
     * 百应只用简易编排 3是简易编排
     */
    private String codeType;

    /**
     * 智能体名称
     */
    private String name;

    /**
     * 三方文档库
     */
    private String externalParam;

    /**
     * 三方文档库
     */
    private Integer impoType;

    /**
     * 插件类型
     */
    private String pluginType;

    /**
     * 插件名称
     */
    private String pluginName;

    /**
     * 插件描述
     */
    private String pluginDesc;

    /**
     * 插件URL
     */
    private String pluginUrl;

    /**
     * 认证类型
     */
    private Integer authType;

    /**
     * 请求头列表
     */
    private List<PluginHeader> headers;

    /**
     * 数据库名称
     */
    private String baseName;

    /**
     * 数据库描述
     */
    private String baseDescribe;

    /**
     * 数据库类型
     */
    private String baseType;

    /**
     * 不能为空，应为有效的类型："006"(知识问答)、"007"(数据分析)、"005"(流程操作) 数字类型
     */
    @NotBlank(groups = Add.class, message = "{agtresource.digitaltype.notblank}")
    @Pattern(regexp = "^(006|007|005)$", message = "{agtresource.digitaltype.pattern}")
    private String digitalType;

    private String id;

    /**
     * 是否知识库页面
     */
    private Boolean isKownledge;

    /**
     * 是否被引用-前台分享
     */
    private Boolean isrefered;

    /**
     * 文档库权限
     */
    private Priviledge priviledge;

    private String agentType;

    /**
     * 资源图标识标识
     */
    private Long datasetLogoId;

    /**
     * 资源Logo URL
     */
    private String resourceLogoUrl;

    private String avatar;

    /**
     * 资源状态
     */
    private Integer status;

    /**
     * 资源创建人id
     */
    private Long createUserId;

    /**
     * MCP服务名称
     */
    private String mcpServerName;

    /**
     * MCP服务描述
     */
    private String mcpComments;

    /**
     * MCP托管类型
     */
    private String hostingType;

    /**
     * MCP类型
     */
    private String mcpType;

    /**
     * MCP服务URL
     */
    private String mcpServerUrl;

    /**
     * MCP内容
     */
    private String mcpContent;

    /**
     * MCP请求头
     */
    private String mcpHeader;

    /**
     * MCP服务ID
     */
    private String mcpServerId;

}
