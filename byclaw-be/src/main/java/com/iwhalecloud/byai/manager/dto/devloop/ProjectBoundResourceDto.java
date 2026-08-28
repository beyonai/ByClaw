package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Getter;
import lombok.Setter;

/**
 * 项目绑定资源查询结果（关联 ss_resource 实时名称与编码）。
 */
@Getter
@Setter
public class ProjectBoundResourceDto {

    /** 平台资源 ID（来自 ss_resource.resource_id） */
    private Long resourceId;

    /** 资源名称（来自 ss_resource.resource_name） */
    private String resourceName;

    /** 资源编码（来自 ss_resource.resource_code） */
    private String resourceCode;

    /** 项目绑定类型：knowledge / digital_employee / ontology */
    private String resourceType;
}
