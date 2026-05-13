package com.iwhalecloud.byai.manager.dto.digitemploy;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.iwhalecloud.byai.manager.dto.scheduletask.ScheduleTaskCreateRequest;
import com.iwhalecloud.byai.manager.dto.template.MemoryConfigDTO;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 数字员工扩展信息DTO 继承 SsResource 获取基础资源字段，手动添加扩展字段
 * 
 * @author he.duming
 * @date 2025-10-29 00:26:06
 */
@Getter
@Setter
public class DigitalEmployeeDTO extends SsResExtDigEmployee {

    /**
     * 外系统编码，BYAI：百应，WHAGE_AGENT:老智能体，BOT：博特，DIFY：DIFY
     */
    private String systemCode;

    /**
     * 资源类型:DIG_EMPLOYEE-数字员工,AGENT-智能体，DOC-文档库 PLGIN-插件 DB-数据库，MCP-MCP服务，TOOL-
     * 工具，MCP_TOOL:MCP工具,TOOLKIT-插件,KG_DOC-文档知识库,KG_DB-数据知识库,KG_DB-术语知识库
     */
    private String resourceBizType;

    /**
     * ATOM：原子资源,COMBIN：组合资源
     */
    private String resourceType;

    /**
     * 资源名称
     */
    private String resourceName;

    /**
     * 资源状态
     */
    private Integer resourceStatus;

    /**
     * 资源描述
     */
    private String resourceDesc;

    /**
     * 资源图标：前端提供的枚举值
     */
    private String avatar;

    /**
     * 常见问题
     */
    private String sample;

    /**
     * 标签:用于关键字检索匹配
     */
    private String tags;

    /**
     * 引用资源版本
     */
    private String resourceVersionId;

    /**
     * 服务模式:hosted:远程，local:本地
     */
    private String hostType;

    /**
     * 资源编码（可选，如果为空则自动生成）
     */
    private String resourceCode;

    /**
     * 资源实现方式
     */
    private String implType;

    /**
     * 资源对应Agent的在Worker中的注册类型
     */
    private String workerAgentType;

    /**
     * 所属目录。
     */
    private Long catalogId;

    /**
     * 资源归属类型：enterprise-企业，personal-个人。
     *
     * 数字员工个人视角查询依赖该字段落到 ss_resource.owner_type，因此这里显式开放给前端传入。
     */
    private String ownerType;

    /**
     * 关联热能
     */
    private List<Long> relIds;

    /***
     * 是否前台创建
     */
    @JsonProperty("isFrontAccess")
    private boolean isFrontAccess = false;

    /**
     * 定时任务配置列表
     */
    private List<ScheduleTaskCreateRequest> scheduleTaskList;

    /**
     * 记忆配置列表（包含规则名称、规则内容、模版ID）
     */
    private List<MemoryConfigDTO> memoryConfigList;

    /**
     * 关联资源信息列表
     */
    private List<RelResourceInfo> relResourceInfoList;

}
