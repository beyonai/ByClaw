package com.iwhalecloud.byai.manager.dto.resource;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 门户知识库文件或目录移动请求。门户传资源 ID，服务端负责转换为 QA knCode。
 */
@Getter
@Setter
public class KnowledgeItemsMoveRequest {

    @NotNull(message = "{knowledge.resourceId.required}")
    private Long resourceId;

    @NotEmpty(message = "{knowledge.move.sourceRequired}")
    private List<@NotBlank(message = "{knowledge.move.sourceRequired}") String> sourcePath = new ArrayList<>();

    private String targetDirectoryPath;

    private String targetFilePath;

    private Boolean overwrite = Boolean.FALSE;
}
