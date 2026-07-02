package com.iwhalecloud.byai.manager.dto.resource;

import java.util.ArrayList;
import java.util.List;

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

    private List<Long> resourceIdList = new ArrayList<>();

    private String query;

    private Integer topK;

    private List<String> fileTypeList = new ArrayList<>();

    private String searchMode;
}
