package com.iwhalecloud.byai.manager.dto.resource;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 门户侧文件元数据查询请求。调用方使用资源 ID，门户内部转换为 QA 知识库编码。
 */
@Getter
@Setter
public class KnowledgeFileMetadataRequest {

    @NotNull(message = "知识库资源标识不能为空")
    private Long resourceId;

    @NotBlank(message = "知识库文件路径不能为空")
    private String filePath;

    /** 不传时返回文件全部元数据；传空数组时语义由 QA 服务决定。 */
    private List<String> metadataFieldList;
}
