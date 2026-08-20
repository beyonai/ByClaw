package com.iwhalecloud.byai.manager.dto.resource;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;

/**
 * 门户知识实体发现请求。门户以知识库资源 ID 定位并校验权限，转发 QA 时转换为 knCode。
 *
 * @author qin.guoquan
 * @date 2026-08-19 16:25:38
 */
@Getter
@Setter
public class KnowledgeEntityDiscoveryRequest {

    @NotNull(message = "知识库资源标识不能为空")
    private Long resourceId;

    /** 原始文档路径；为空时处理知识库内全部符合条件的原始文档。 */
    private String filePath;

    @Positive(message = "最大实体数必须大于 0")
    @Max(value = 12, message = "最大实体数不能超过 12")
    private Integer maxEntities = 12;

    private Boolean force = false;

    private Map<String, Object> extraParams = new LinkedHashMap<>();
}
