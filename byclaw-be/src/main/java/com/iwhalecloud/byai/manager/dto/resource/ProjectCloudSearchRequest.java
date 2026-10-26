package com.iwhalecloud.byai.manager.dto.resource;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * 工作组云盘的服务端筛选参数，不接受任意知识库编码或调用方 DSL。
 * @author Codex
 * @date 2026-10-26
 */
@Getter
@Setter
public class ProjectCloudSearchRequest {

    @NotNull(message = "{knowledge.resourceId.required}")
    private Long resourceId;

    @Size(max = 200, message = "{dataset.cloud.search.keyword.invalid}")
    private String keyword;

    @Size(max = 32, message = "{dataset.cloud.search.type.invalid}")
    private String fileType;

    private Long creatorId;

    /** ISO 8601 时间，开始包含、结束不包含，必须携带时区。 */
    private String createdFrom;

    private String createdBefore;

    @NotNull(message = "{dataset.metadata.search.page.num.positive}")
    @Positive(message = "{dataset.metadata.search.page.num.positive}")
    private Integer pageNum = 1;

    @NotNull(message = "{dataset.metadata.search.page.size.positive}")
    @Positive(message = "{dataset.metadata.search.page.size.positive}")
    @Max(value = 100, message = "{dataset.cloud.search.page.size.invalid}")
    private Integer pageSize = 20;
}
