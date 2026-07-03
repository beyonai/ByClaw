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
        return ResponseUtil.successRes(ontologyBaseService.listBases(request.getOwnerType(), request.getQueryKeyword()));
    }

    @ApiOperation("创建本体库")
    @PostMapping("/base/create")
    public ResponseUtil<JSONObject> createBase(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.createBase(request));
    }

    @ApiOperation("更新本体库")
    @PostMapping("/base/update")
    public ResponseUtil<JSONObject> updateBase(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.updateBase(request));
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

    @ApiOperation("创建场景")
    @PostMapping("/scene/create")
    public ResponseUtil<JSONObject> createScene(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.createScene(request));
    }

    @ApiOperation("更新场景")
    @PostMapping("/scene/update")
    public ResponseUtil<JSONObject> updateScene(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.updateScene(request));
    }

    @ApiOperation("删除场景")
    @PostMapping("/scene/delete")
    public ResponseUtil<JSONObject> deleteScene(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.deleteScene(request));
    }

    @ApiOperation("场景下本体分页查询")
    @PostMapping("/scene/ontology/page")
    public ResponseUtil<JSONObject> querySceneOntologies(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.querySceneOntologies(request));
    }

    @ApiOperation("添加场景成员")
    @PostMapping("/scene/member/add")
    public ResponseUtil<JSONObject> addSceneMembers(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.addSceneMembers(request));
    }

    @ApiOperation("移除场景成员")
    @PostMapping("/scene/member/remove")
    public ResponseUtil<JSONObject> removeSceneMembers(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.removeSceneMembers(request));
    }

    @ApiOperation("对象列表")
    @PostMapping("/object/list")
    public ResponseUtil<JSONArray> listObjects(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.listObjects(request));
    }

    @ApiOperation("对象详情：属性/动作")
    @PostMapping("/object/detail")
    public ResponseUtil<JSONObject> objectDetail(@RequestBody OntologyBaseQueryRequest request) {
        return ResponseUtil
            .successRes(ontologyBaseService.objectDetail(request.getOwnerType(), request.getBaseId(),
                request.getObjectCode()));
    }

    @ApiOperation("创建对象")
    @PostMapping("/object/create")
    public ResponseUtil<JSONObject> createObject(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.createObject(request));
    }

    @ApiOperation("更新对象")
    @PostMapping("/object/update")
    public ResponseUtil<JSONObject> updateObject(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.updateObject(request));
    }

    @ApiOperation("删除对象")
    @PostMapping("/object/delete")
    public ResponseUtil<JSONObject> deleteObject(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.deleteObject(request));
    }

    @ApiOperation("视图列表")
    @PostMapping("/view/list")
    public ResponseUtil<JSONArray> listViews(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.listViews(request));
    }

    @ApiOperation("视图详情")
    @PostMapping("/view/detail")
    public ResponseUtil<JSONObject> viewDetail(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.viewDetail(request));
    }

    @ApiOperation("创建视图")
    @PostMapping("/view/create")
    public ResponseUtil<JSONObject> createView(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.createView(request));
    }

    @ApiOperation("更新视图")
    @PostMapping("/view/update")
    public ResponseUtil<JSONObject> updateView(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.updateView(request));
    }

    @ApiOperation("删除视图")
    @PostMapping("/view/delete")
    public ResponseUtil<JSONObject> deleteView(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.deleteView(request));
    }

    @ApiOperation("关系列表")
    @PostMapping("/relation/list")
    public ResponseUtil<JSONArray> listRelations(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.listRelations(request));
    }

    @ApiOperation("关系详情")
    @PostMapping("/relation/detail")
    public ResponseUtil<JSONObject> relationDetail(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.relationDetail(request));
    }

    @ApiOperation("创建关系")
    @PostMapping("/relation/create")
    public ResponseUtil<JSONObject> createRelation(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.createRelation(request));
    }

    @ApiOperation("更新关系")
    @PostMapping("/relation/update")
    public ResponseUtil<JSONObject> updateRelation(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.updateRelation(request));
    }

    @ApiOperation("删除关系")
    @PostMapping("/relation/delete")
    public ResponseUtil<JSONObject> deleteRelation(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.deleteRelation(request));
    }

    @ApiOperation("数据源列表")
    @PostMapping("/datasource/list")
    public ResponseUtil<JSONArray> listDatasources(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.listDatasources(request));
    }

    @ApiOperation("数据源详情")
    @PostMapping("/datasource/detail")
    public ResponseUtil<JSONObject> datasourceDetail(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.datasourceDetail(request));
    }

    @ApiOperation("创建数据源")
    @PostMapping("/datasource/create")
    public ResponseUtil<JSONObject> createDatasource(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.createDatasource(request));
    }

    @ApiOperation("删除数据源")
    @PostMapping("/datasource/delete")
    public ResponseUtil<JSONObject> deleteDatasource(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.deleteDatasource(request));
    }

    @ApiOperation("对象动作列表")
    @PostMapping("/action/list")
    public ResponseUtil<JSONArray> listActions(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.listActions(request));
    }

    @ApiOperation("对象动作详情")
    @PostMapping("/action/detail")
    public ResponseUtil<JSONObject> actionDetail(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.actionDetail(request));
    }

    @ApiOperation("创建对象动作")
    @PostMapping("/action/create")
    public ResponseUtil<JSONObject> createAction(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.createAction(request));
    }

    @ApiOperation("更新对象动作")
    @PostMapping("/action/update")
    public ResponseUtil<JSONObject> updateAction(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.updateAction(request));
    }

    @ApiOperation("删除对象动作")
    @PostMapping("/action/delete")
    public ResponseUtil<JSONObject> deleteAction(@RequestBody JSONObject request) {
        return ResponseUtil.successRes(ontologyBaseService.deleteAction(request));
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
