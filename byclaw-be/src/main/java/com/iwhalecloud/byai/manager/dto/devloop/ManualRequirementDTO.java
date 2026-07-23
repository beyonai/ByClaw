package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/** 手工录入的项目需求。 */
@Data
public class ManualRequirementDTO {

    private Long projectId;

    /** manual / customer_feedback / internal_proposal */
    private String sourceType;

    private String branch;

    private String title;

    private String originalContent;

    private String productContent;
}
