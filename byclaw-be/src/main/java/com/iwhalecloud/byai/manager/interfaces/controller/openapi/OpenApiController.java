package com.iwhalecloud.byai.manager.interfaces.controller.openapi;

import com.iwhalecloud.byai.manager.application.service.openapi.OpenApiApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.OntologyOpenService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceCatalogService;
import com.iwhalecloud.byai.manager.dto.men.Notices;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyActionSaveRequest;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceCatalog;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.organization.CatalogQo;
import jakarta.validation.Valid;

import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * @author he.duming
 * @date 2025-05-26 09:54:45
 * @description 系统内接口对外统一处理
 */
@RestController
@RequestMapping("/open/api")
public class OpenApiController {

    @Autowired
    private OntologyOpenService ontologyOpenService;

    @Autowired
    private OpenApiApplicationService openApiApplicationService;

    @Autowired
    private SsResourceCatalogService ssResourceCatalogService;

    /**
     * 保存对象的动作相关内容 包括：动作和动作属性
     *
     * @param request 动作保存请求
     * @return ResponseUtil
     */
    @PostMapping("/createOrUpdateOntology")
    @ManageLogAnnotation(name = "保存对象动作", description = "保存对象的动作相关内容，包括动作和动作属性")
    public ResponseUtil<Map<String, Object>> saveBatchOpen(@Valid @RequestBody OntologyActionSaveRequest request) {
        return ResponseUtil.successRes(ontologyOpenService.saveBatchOpen(request));
    }

    /**
     * 创建通知
     *
     * @param notices 通知
     * @return ResponseUtil
     */
    @PostMapping("/notice/create")
    @ManageLogAnnotation(name = "会话API调用", description = "创建通知")
    public ResponseUtil<String> createNotice(@RequestBody @Valid Notices notices) {
        openApiApplicationService.createNotice(notices);
        return ResponseUtil.successRes(ResponseUtil.RESULTMSG_MSG);
    }

    /**
     * 查询挂载目录
     *
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "查询挂载目录")
    @PostMapping("/v1/queryCatalogTree")
    public ResponseUtil<List<SsResourceCatalog>> queryCatalogTree(@RequestBody @Validated CatalogQo catalogQo) {
        // 只查询领域的目录
        catalogQo.setCatalogType(6);
        List<SsResourceCatalog> catalogs = ssResourceCatalogService.queryCatalogTree(catalogQo);
        return ResponseUtil.successResponse(catalogs);
    }

}
