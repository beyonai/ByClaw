package com.iwhalecloud.byai.manager.dto.resource;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;

/**
 * 门户文件级语义检索请求。
 * 门户仅接受 ByClaw 知识库资源 ID，服务端会转换为 QA 的 knCode 并校验当前用户使用权限。
 *
 * @author qin.guoquan
 * @date 2026-7-13 17:38:38
 */
@Getter
@Setter
public class KnowledgeFileSearchRequest {

    @NotBlank(message = "{knowledge.search.textRequired}")
    private String query;

    @NotEmpty(message = "{knowledge.resourceIds.required}")
    private List<Long> resourceIdList = new ArrayList<>();

    /** Agent DSL 过滤 AST。 */
    private Map<String, Object> where;

    @NotBlank(message = "{knowledge.search.modeRequired}")
    private String searchMode;

    private List<String> metadataFieldList = new ArrayList<>();

    @NotNull(message = "{knowledge.search.limitRequired}")
    @Positive(message = "{knowledge.search.limitPositive}")
    private Integer topK;
}
