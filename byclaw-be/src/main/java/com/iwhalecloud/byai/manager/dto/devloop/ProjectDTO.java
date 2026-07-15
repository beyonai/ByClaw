package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

import java.util.List;

@Data
public class ProjectDTO {

    private Long projectId;

    private String projectName;

    private String description;

    private Long resourceId;

    private List<ProjectRepoDTO> repos;
}
