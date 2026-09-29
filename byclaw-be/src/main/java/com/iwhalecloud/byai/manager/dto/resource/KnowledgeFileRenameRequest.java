package com.iwhalecloud.byai.manager.dto.resource;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/** 按资源和原始路径重命名文件，文件名不能包含目录路径。 */
@Getter
@Setter
public class KnowledgeFileRenameRequest {

    @NotNull
    private Long resourceId;

    @NotBlank
    private String filePath;

    @NotBlank
    private String fileName;
}
