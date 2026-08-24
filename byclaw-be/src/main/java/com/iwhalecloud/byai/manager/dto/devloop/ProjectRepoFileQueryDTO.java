package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/** 查询远程仓库文件内容的请求参数。 */
@Data
public class ProjectRepoFileQueryDTO {

    private Long repoId;

    /** 远程分支名称。 */
    private String branch;

    /** 文件在仓库中的完整路径，来自目录查询接口返回的 path。 */
    private String path;
}
