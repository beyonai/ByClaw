package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/** 项目资源绑定入参/出参。 */
@Data
public class ProjectResourceDTO {
    private Long id;
    private Long projectId;
    private String resourceType;
    private String resourceId;
    private String resourceName;
    private Integer sortNo;
}
