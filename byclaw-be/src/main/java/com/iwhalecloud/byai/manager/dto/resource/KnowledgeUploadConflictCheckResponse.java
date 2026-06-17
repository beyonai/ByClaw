package com.iwhalecloud.byai.manager.dto.resource;

import java.util.ArrayList;
import java.util.List;

import lombok.Getter;
import lombok.Setter;

/**
 * 知识库文件上传前同路径同名冲突检查响应。
 *
 * @author qin.guoquan
 * @date 2026-06-16 16:38:38
 */
@Getter
@Setter
public class KnowledgeUploadConflictCheckResponse {

    private boolean conflict;

    /**
     * 已存在、需要覆盖的文件完整路径。
     */
    private List<String> overwritePaths = new ArrayList<>();
}
