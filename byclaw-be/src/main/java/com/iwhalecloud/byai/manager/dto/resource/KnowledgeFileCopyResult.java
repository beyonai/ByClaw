package com.iwhalecloud.byai.manager.dto.resource;

import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/** 返回目标资源和完整文件路径，供转发方生成独立的文件引用。 */
@Getter
@Setter
public class KnowledgeFileCopyResult {
    private Long sourceResourceId;
    private String sourceFilePath;
    private Long targetResourceId;
    private String targetFilePath;
    private String fileName;
    private long fileSize;
    private boolean success;
    private List<String> postProcessErrors = new ArrayList<>();
}
