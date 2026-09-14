package com.iwhalecloud.byai.manager.dto.resource;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.util.LinkedHashMap;
import java.util.List;
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

    /** 原始文档路径；传入时优先于 directoryPath。 */
    private String filePath;

    /** 原始文档目录，递归处理子目录；未传 filePath 时生效。 */
    private String directoryPath;

    /**
     * KnowledgeEntity 输出目录；为空时由 QA 使用默认目录。
     */
    private String targetDirectoryPath;

    @Positive(message = "最大实体数必须大于 0")
    @Max(value = 12, message = "最大实体数不能超过 12")
    private Integer maxEntities = 12;

    private Boolean force = false;

    /**
     * 追加到本次 Discovery 实际创建或锚定到的 KnowledgeEntity metadata。
     */
    private List<String> tags;

    private Map<String, Object> extraParams = new LinkedHashMap<>();
}
