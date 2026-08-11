package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/**
 * 查询项目仓库目录的请求参数。
 * <p>path 为空时查询仓库根目录，展开目录时把目录节点的 path 原样传回即可。</p>
 */
@Data
public class ProjectRepoTreeQueryDTO {

    private Long projectId;

    private Long repoId;

    /** 目录路径，使用仓库内的正斜杠分隔；根目录为空。 */
    private String path;

    /** 分支或 tag；为空时使用项目仓库配置的默认分支。 */
    private String ref;

    /** 文件名或仓库内路径搜索词。 */
    private String keyword;
}
