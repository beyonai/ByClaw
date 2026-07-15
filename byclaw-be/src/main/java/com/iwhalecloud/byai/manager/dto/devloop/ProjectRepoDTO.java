package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

@Data
public class ProjectRepoDTO {

    private Long repoId;

    private String repoFullName;

    private String repoUrl;

    private String defaultBranch;
}
