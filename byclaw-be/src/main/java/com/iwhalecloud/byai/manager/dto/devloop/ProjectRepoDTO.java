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

    /** 仓库用途描述,可选;供需求 AI 预拆判断该改哪些仓库 */
    private String description;

    /** 仓库类型 workspace工作区/code代码仓库;缺省按 code 处理 */
    private String repoType;

    /** 代码平台 github/gitlab/gitea;缺省按 github 处理 */
    private String provider;
}
