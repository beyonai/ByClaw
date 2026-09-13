package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/** 项目空间目录节点；Git 元数据只在目录节点上返回。 */
@Data
public class ProjectSpaceTreeNodeDTO {

    private String name;
    private String path;
    private String type;
    private Long size;
    private String lastModified;
    private Boolean hasChildren;
    private Boolean gitRepository;
    private Long repoId;
    private String defaultBranch;
    private Boolean changesSupported;
    private String remoteUrl;

    /** 数据源类型：project-repo 为已登记仓库，project-space-git 为本地发现但未登记的 Git 仓库。 */
    private String sourceType;
}
