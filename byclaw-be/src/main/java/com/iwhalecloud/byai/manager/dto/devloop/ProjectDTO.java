package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

import java.util.List;

@Data
public class ProjectDTO {

    private Long projectId;

    private String projectName;

    private String description;

    private Long resourceId;

    /** 项目类型：normal普通项目，develop研发项目 */
    private String projectType;

    /** 是否分享：N-不分享，Y-可分享 */
    private String isShare;

    private List<ProjectRepoDTO> repos;
}
