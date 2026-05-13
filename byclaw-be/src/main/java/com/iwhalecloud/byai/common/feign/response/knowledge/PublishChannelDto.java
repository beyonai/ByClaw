package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Data;

@Data
public class PublishChannelDto {

    private Long projectId;

    private String projectName;

    private String projectDesc;

    private Long catalogId;

    private Long orgId;

    private String manUserId;

    private Long projectType;

    private Boolean enable;
}
