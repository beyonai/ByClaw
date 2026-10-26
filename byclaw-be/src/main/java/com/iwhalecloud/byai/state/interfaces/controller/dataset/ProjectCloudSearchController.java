package com.iwhalecloud.byai.state.interfaces.controller.dataset;

import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeMetadataSearchResult;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.dto.resource.ProjectCloudSearchRequest;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.application.service.dataset.ProjectCloudSearchApplicationService;

/**
 * 工作组云盘搜索入口，复用知识库的鉴权与元数据检索链路。
 * @author Codex
 * @date 2026-10-26
 */
@RestController
@RequestMapping("/datasetController/projectCloud")
public class ProjectCloudSearchController {

    @Autowired
    private ProjectCloudSearchApplicationService search;

    /**
     * 按名称、创建时间、扩展名和创建人查询当前项目云盘。
     * @param request 筛选及分页参数
     * @return 匹配条目和准确总数
     */
    @PostMapping("/search")
    public ResponseUtil<KnowledgeMetadataSearchResult> search(@Valid @RequestBody ProjectCloudSearchRequest request) {
        return ResponseUtil.successResponse(I18nUtil.get("dataset.cloud.search.success"), search.search(request));
    }
}
