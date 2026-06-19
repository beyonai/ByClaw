package com.iwhalecloud.byai.manager.dto.resource;

import java.util.ArrayList;
import java.util.List;

import lombok.Getter;
import lombok.Setter;

/**
 * 知识库文件上传前同路径同名冲突检查请求。
 *
 * @author qin.guoquan
 * @date 2026-06-16 16:38:38
 */
@Getter
@Setter
public class KnowledgeUploadConflictCheckRequest {

    private Long resourceId;

    /**
     * 上传目标目录，根目录为 "/"。
     */
    private String directoryPath;

    /**
     * 待上传文件名列表。
     */
    private List<String> fileNames = new ArrayList<>();
}
