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

    @NotNull(message = "知识库资源标识不能为空")
    private Long resourceId;

    @NotEmpty(message = "移动源路径不能为空")
    private List<@NotBlank(message = "移动源路径不能为空") String> sourcePath = new ArrayList<>();

    private String targetDirectoryPath;

    private String targetFilePath;

    private Boolean overwrite = Boolean.FALSE;
}
