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

    @NotEmpty(message = "知识库资源标识列表不能为空")
    private List<@NotNull(message = "知识库资源标识不能为空") Long> resourceIdList = new ArrayList<>();

    @NotBlank(message = "检索文本不能为空")
    private String query;

    @NotNull(message = "返回条数不能为空")
    @Positive(message = "返回条数必须大于0")
    private Integer topK;

    private Map<String, Object> where;

    private List<String> metadataFieldList = new ArrayList<>();

    private List<String> fileTypeList = new ArrayList<>();

    @NotBlank(message = "检索模式不能为空")
    private String searchMode;
}
