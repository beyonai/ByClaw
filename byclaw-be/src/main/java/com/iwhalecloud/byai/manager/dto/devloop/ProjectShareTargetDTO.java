package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

@Data
public class ProjectShareTargetDTO {

    private Long targetId;

    /** 共享对象类型：USER人员，ORG组织 */
    private String targetType;

}
