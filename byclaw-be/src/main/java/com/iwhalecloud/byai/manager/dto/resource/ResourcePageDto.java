package com.iwhalecloud.byai.manager.dto.resource;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;

@Setter
@Getter
public class ResourcePageDto extends SsResource {

    /**
     * 上架目录
     */
    private String catalogName;

    private Integer catalogType;

    /**
     * 归属组织名称
     */
    private String manOrgName;

    /**
     * 是否允许回退
     */
    private boolean isRollback;

    /**
     * 资源创建用户名称
     */
    private String createUserName;

    private String datasetName;

    /**
     * 资源审批用户名称
     */
    private String manUserName;

    private String pid;

    private String resourceType;

    /**
     * 资源id字符串
     */
    private String resourceIdStr;

    private String agentType;

    private String resourceSourcePkIdStr;

    private String createType;

    private String shareRange;

    private Integer isTop;

    /**
     * 集成方式：默认为NONE，可选：PAGE（页面集成）、INTERFACE（接口集成）
     */
    private String integrationType;

    /**
     * 所有的权限id
     */
    private String manPrivIds;

    /**
     * 所有有权限的名称
     */
    private String manPrivNames;

    /**
     * 置顶时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date topTime;

    /**
     * 是否发布到业务门户：1-是，0-否
     */
    private Integer publishPortal;

    private String type;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long pluginMachineId;

    private String kdbId;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long taskId;

    /**
     * 审批意见
     */
    private String approvalContent;

}