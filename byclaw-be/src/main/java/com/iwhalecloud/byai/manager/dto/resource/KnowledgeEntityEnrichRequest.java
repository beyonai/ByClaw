package com.iwhalecloud.byai.manager.dto.resource;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;

/**
 * 门户知识实体补全请求。门户以知识库资源 ID 定位并校验权限，转发 QA 时转换为 knCode。
 *
 * @author qin.guoquan
 * @date 2026-08-19 16:25:38
 */
@Getter
@Setter
public class KnowledgeEntityEnrichRequest {

    @NotNull(message = "知识库资源标识不能为空")
    private Long resourceId;

    /** KnowledgeEntity 文件路径；为空时处理固定目录中的全部符合条件实体文档。 */
    private String filePath;

    @Positive(message = "证据候选数必须大于 0")
    private Integer topK = 20;

    private Boolean force = false;

    private Map<String, Object> extraParams = new LinkedHashMap<>();
}
