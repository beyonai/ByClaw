package com.iwhalecloud.byai.manager.dto.devloop;

import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.List;

@Data
public class ProjectDTO {

    private Long projectId;

    /** 项目名称最多 100 个字符，与项目空间前端表单保持一致。 */
    @Size(max = 100, message = "项目名称不能超过100个字符")
    private String projectName;

    /** 项目描述最多 500 个字符，与项目空间前端表单保持一致。 */
    @Size(max = 500, message = "项目描述不能超过500个字符")
    private String description;

    private Long resourceId;

    /** 项目类型：normal普通项目，develop研发项目 */
    private String projectType;

    /** 是否分享：N-不分享，Y-可分享 */
    private String isShare;

    private List<ProjectRepoDTO> repos;

    /** 共享对象：支持 USER 人员、ORG 组织 */
    private List<ProjectShareTargetDTO> shareTargets;

    /** 新建/编辑时绑定的知识库、数字员工、本体资源。 */
    private List<ProjectResourceDTO> resources;
}
