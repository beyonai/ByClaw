package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/** 远程仓库分支。 */
@Data
public class ProjectRepoBranchDTO {

    private String name;
    private String sha;
    private Boolean protectedBranch;
}
