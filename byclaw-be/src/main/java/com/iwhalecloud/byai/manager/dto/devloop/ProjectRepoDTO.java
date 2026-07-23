package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

@Data
public class ProjectRepoDTO {

    private Long repoId;

    /** 所属项目ID，单独新增仓库时必填 */
    private Long projectId;

    private String repoFullName;

    private String repoUrl;

    private String defaultBranch;
}
