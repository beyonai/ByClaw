package com.iwhalecloud.byai.manager.dto.resource;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Getter;
import lombok.Setter;

/**
 * 通过 ByClaw 知识库资源 ID 列表执行知识 chunk 检索。
 *
 * @author qin.guoquan
 * @date 2026-07-02 15:18:38
 */
@Getter
@Setter
public class KnowledgeSearchRequest {

    @NotEmpty(message = "{knowledge.resourceIds.required}")
    private List<@NotNull(message = "{knowledge.resourceId.required}") Long> resourceIdList = new ArrayList<>();

    @NotBlank(message = "{knowledge.search.textRequired}")
    private String query;

    @NotNull(message = "{knowledge.search.limitRequired}")
    @Positive(message = "{knowledge.search.limitPositive}")
    private Integer topK;

    private Map<String, Object> where;

    private List<String> metadataFieldList = new ArrayList<>();

    private List<String> fileTypeList = new ArrayList<>();

    @NotBlank(message = "{knowledge.search.modeRequired}")
    private String searchMode;
}
