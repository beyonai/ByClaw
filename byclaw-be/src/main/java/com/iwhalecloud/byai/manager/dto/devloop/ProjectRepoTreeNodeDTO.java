package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/** 远程代码仓库目录节点，字段保持 provider 无关。 */
@Data
public class ProjectRepoTreeNodeDTO {

    private String name;
    private String path;
    /** directory 或 file。 */
    private String type;
    private Long size;
    private String sha;
    private String url;
    private Boolean hasChildren;
}
