package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Data;

@Data
public class PublicApp {
    private Long appId;
    private Long catalogId;
    private Boolean fromSpaceFlag;
    private Integer isPublishStore = 1;
    private String name;
    private String openType;
    private String publishType;
    private String remark;
    private Integer resourceStatus;
    private Long versionId;
}
