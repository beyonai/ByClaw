package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * QA 知识库文件或目录移动请求，对应 POST /api/v1/knowledgeItems/move。
 */
@Getter
@Setter
public class KbKnowledgeItemsMove {

    private String knCode;

    private List<String> sourcePath = new ArrayList<>();

    private String targetDirectoryPath;

    private String targetFilePath;

    private Boolean overwrite = Boolean.FALSE;
}
