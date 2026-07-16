package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

@Data
public class ProjectShareTargetDTO {

    private Long shareId;

    private Long projectId;

    /** 共享对象类型：USER人员，ORG组织 */
    private String targetType;

    private Long targetId;

    private String targetName;
}
