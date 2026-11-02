package com.iwhalecloud.byai.manager.dto.resource;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Getter;
import lombok.Setter;

/** 复制单个知识库或项目云盘文档；资源编码及创建账号均由服务端解析。 */
@Getter
@Setter
public class KnowledgeFileCopyRequest {

    @NotNull
    @Positive
    private Long sourceResourceId;

    @NotBlank
    private String sourceFilePath;

    @NotNull
    @Positive
    private Long targetResourceId;

    /** 缺省为目标知识库根目录，目录必须已经存在。 */
    private String targetDirectoryPath;

    /** 缺省沿用源文件名，不允许目录分隔符。 */
    private String targetFileName;
}
