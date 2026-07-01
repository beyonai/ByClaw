package com.iwhalecloud.byai.manager.interfaces.controller.resource;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.manager.application.service.ontology.OntologyBaseService;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyBaseQueryRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyBaseRegisterRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyRefreshResult;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 本体库管理控制器：本体库/场景/对象的浏览（转发 datacloud）+ 本体库注册/注销（快照进 ss_resource）。
 *
 * @author qin.guoquan
 * @date 2026-06-29 17:38:38
 */
@Api(tags = "本体库管理")
@RestController
@RequestMapping("/ontology")
@Validated
public class OntologyBaseController {

    @Autowired
    private OntologyBaseService ontologyBaseService;

    @ApiOperation("本体库列表")
    @PostMapping("/base/list")
    public ResponseUtil<JSONArray> listBases(@RequestBody OntologyBaseQueryRequest request) {
        return ResponseUtil.successRes(ontologyBaseService.listBases(request.getOwnerType()));
    }

    @ApiOperation("场景列表")
    @PostMapping("/scene/list")
    public ResponseUtil<JSONArray> listScenes(@RequestBody OntologyBaseQueryRequest request) {
        return ResponseUtil
            .successRes(ontologyBaseService.listScenes(request.getOwnerType(), request.getBaseId(),
                request.getQueryKeyword()));
    }

    @ApiOperation("场景详情：对象/视图/关系")
    @PostMapping("/scene/detail")
    public ResponseUtil<JSONObject> sceneDetail(@RequestBody OntologyBaseQueryRequest request) {
        return ResponseUtil
            .successRes(ontologyBaseService.sceneDetail(request.getOwnerType(), request.getBaseId(),
                request.getSceneId()));
    }

    @ApiOperation("对象详情：属性/动作")
    @PostMapping("/object/detail")
    public ResponseUtil<JSONObject> objectDetail(@RequestBody OntologyBaseQueryRequest request) {
        return ResponseUtil
            .successRes(ontologyBaseService.objectDetail(request.getOwnerType(), request.getBaseId(),
                request.getObjectCode()));
    }

    @ApiOperation("本体库 ss_resource 子树")
    @PostMapping("/base/tree")
    public ResponseUtil<java.util.List<SsResource>> tree(@RequestBody OntologyBaseQueryRequest request) {
        return ResponseUtil.successRes(ontologyBaseService.tree(request.getBaseId()));
    }

    @ApiOperation("注册本体库")
    @PostMapping("/base/register")
    @ManageLogAnnotation(name = "注册本体库", description = "注册/创建本体库并快照进 ss_resource")
    public ResponseUtil<SsResource> registerBase(@Valid @RequestBody OntologyBaseRegisterRequest request) {
        return ResponseUtil.successRes(ontologyBaseService.registerBase(request));
    }

    @ApiOperation("刷新本体库：从本体管理门户拉取最新本体库并 upsert 进 ss_resource")
    @PostMapping("/base/refresh")
    @ManageLogAnnotation(name = "刷新本体库", description = "从本体管理门户拉取最新本体库并 upsert 进 ss_resource")
    public ResponseUtil<OntologyRefreshResult> refresh(@RequestBody OntologyBaseQueryRequest request) {
        return ResponseUtil.successRes(ontologyBaseService.refreshEnterpriseBases(request.getOwnerType()));
    }

    @ApiOperation("注销本体库")
    @PostMapping("/base/delete")
    @ManageLogAnnotation(name = "注销本体库", description = "注销本体库并级联清理 ss_resource")
    public ResponseUtil<Boolean> deleteBase(@RequestBody OntologyBaseQueryRequest request) {
        return ResponseUtil.successRes(ontologyBaseService.deleteBase(request.getOwnerType(), request.getBaseId()));
    }
}
