package com.iwhalecloud.byai.manager.application.service.ontology;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.feign.client.FeignDataCloudService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyBaseRegisterRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyRefreshResult;
import com.iwhalecloud.byai.manager.entity.ontology.SsResExtOntology;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.ontology.SsResExtOntologyMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 本体库服务：包 datacloud 本体接口，并把本体库/场景/对象/视图快照进 ss_resource（resourceBizType
 * ONTOLOGY_BASE/SCENE/OBJECT/VIEW + parentResourceId 树；本体库编码存扩展表 ss_res_ext_ontology.pid），供门户浏览与数字员工绑定。
 *
 * <p>注：REMOTE 本体库本期只落库级、不快照子树（元数据动态、避免漂移）。
 *
 * @author qin.guoquan
 * @date 2026-06-29 17:38:38
 */
@Service
public class OntologyBaseService {

    private static final Logger logger = LoggerFactory.getLogger(OntologyBaseService.class);

    private static final String LOCAL = "LOCAL";
    private static final String REMOTE = "REMOTE";
    private static final String RESOURCE_TYPE_ATOM = "ATOM";
    private static final String SYSTEM_CODE_DATACLOUD = "byclaw-datacloud";
    private static final Long ROOT_PARENT_ID = -1L;
    /** 平台管理员 adminvip 的用户 id：企业本体刷新时统一记为创建者/更新者（写死，避免按编码查库）。 */
    private static final Long ADMIN_VIP_USER_ID = 10001L;
    private static final String ADMIN_VIP_USER_CODE = "adminvip";

    @Autowired
    private FeignDataCloudService feignDataCloudService;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private SsResExtOntologyMapper ssResExtOntologyMapper;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private AuthApplicationService authApplicationService;

    /**
     * 本体库列表（转发 datacloud）。注意：datacloud listOntologyBases 响应不含 ownerType 字段，
     * 无法在此按个人/企业过滤；个人/企业区分由 ss_resource 层（ownerType 列）负责，这里返回全部。
     */
    public JSONArray listBases(String ownerType) {
        return listBases(ownerType, null);
    }

    public JSONArray listBases(String ownerType, String keyword) {
        JSONArray bases = feignDataCloudService.listOntologyBases(ownerType, keyword);
        return bases == null ? new JSONArray() : bases;
    }

    /** 场景列表（转发 datacloud）。 */
    public JSONArray listScenes(String ownerType, String baseId, String queryKeyword) {
        return feignDataCloudService.listScenes(normalizeOwnerType(ownerType), baseId, queryKeyword);
    }

    /** 场景详情：对象/视图/关系（转发 datacloud）。 */
    public JSONObject sceneDetail(String ownerType, String baseId, String sceneId) {
        return feignDataCloudService.getSceneDetails(normalizeOwnerType(ownerType), baseId, sceneId);
    }

    /** 对象详情：属性 + 动作（转发 datacloud）。 */
    public JSONObject objectDetail(String ownerType, String baseId, String objectCode) {
        return feignDataCloudService.getObjectDetail(normalizeOwnerType(ownerType), baseId, objectCode);
    }

    public JSONObject createBase(JSONObject request) {
        return feignDataCloudService.createOntologyBase(payload(request));
    }

    public JSONObject updateBase(JSONObject request) {
        return feignDataCloudService.updateOntologyBase(requiredString(request, "baseId"), payload(request));
    }

    public JSONObject createScene(JSONObject request) {
        return feignDataCloudService.createScene(requiredString(request, "baseId"), payload(request));
    }

    public JSONObject updateScene(JSONObject request) {
        return feignDataCloudService.updateScene(requiredString(request, "baseId"), requiredString(request, "sceneId"),
            payload(request));
    }

    public JSONObject deleteScene(JSONObject request) {
        return feignDataCloudService.deleteScene(requiredString(request, "baseId"), requiredString(request, "sceneId"));
    }

    public JSONObject querySceneOntologies(JSONObject request) {
        return feignDataCloudService.queryOntologiesByScene(requiredString(request, "baseId"),
            requiredString(request, "sceneId"), request.getInteger("page"), request.getInteger("pageSize"),
            keyword(request), cacheMode(request));
    }

    public JSONObject addSceneMembers(JSONObject request) {
        return feignDataCloudService.addSceneMembers(requiredString(request, "baseId"), requiredString(request, "sceneId"),
            payload(request));
    }

    public JSONObject removeSceneMembers(JSONObject request) {
        return feignDataCloudService.removeSceneMembers(requiredString(request, "baseId"),
            requiredString(request, "sceneId"), payload(request));
    }

    public JSONArray listObjects(JSONObject request) {
        return feignDataCloudService.listObjects(requiredString(request, "baseId"), cacheMode(request));
    }

    public JSONObject createObject(JSONObject request) {
        return feignDataCloudService.createObject(requiredString(request, "baseId"), payload(request));
    }

    public JSONObject updateObject(JSONObject request) {
        return feignDataCloudService.updateObject(requiredString(request, "baseId"),
            requiredString(request, "objectCode", "code"), payload(request));
    }

    public JSONObject deleteObject(JSONObject request) {
        return feignDataCloudService.deleteObject(requiredString(request, "baseId"),
            requiredString(request, "objectCode", "code"));
    }

    public JSONArray listViews(JSONObject request) {
        return feignDataCloudService.listViewsByBase(requiredString(request, "baseId"), cacheMode(request));
    }

    public JSONObject viewDetail(JSONObject request) {
        return feignDataCloudService.getViewDetail(requiredString(request, "baseId"),
            requiredString(request, "viewCode", "code"), cacheMode(request));
    }

    public JSONObject createView(JSONObject request) {
        return feignDataCloudService.createView(requiredString(request, "baseId"), payload(request));
    }

    public JSONObject updateView(JSONObject request) {
        return feignDataCloudService.updateView(requiredString(request, "baseId"),
            requiredString(request, "viewCode", "code"), payload(request));
    }

    public JSONObject deleteView(JSONObject request) {
        return feignDataCloudService.deleteView(requiredString(request, "baseId"), requiredString(request, "viewCode",
            "code"));
    }

    public JSONArray listRelations(JSONObject request) {
        return feignDataCloudService.listRelationsByBase(requiredString(request, "baseId"),
            cacheMode(request));
    }

    public JSONObject relationDetail(JSONObject request) {
        return feignDataCloudService.getRelationDetail(requiredString(request, "baseId"),
            requiredString(request, "relationCode", "code"), cacheMode(request));
    }

    public JSONObject createRelation(JSONObject request) {
        return feignDataCloudService.createRelation(requiredString(request, "baseId"), payload(request));
    }

    public JSONObject updateRelation(JSONObject request) {
        return feignDataCloudService.updateRelation(requiredString(request, "baseId"),
            requiredString(request, "relationCode", "code"), payload(request));
    }

    public JSONObject deleteRelation(JSONObject request) {
        return feignDataCloudService.deleteRelation(requiredString(request, "baseId"),
            requiredString(request, "relationCode", "code"));
    }

    public JSONArray listDatasources(JSONObject request) {
        return feignDataCloudService.listDatasources(requiredString(request, "baseId"), cacheMode(request));
    }

    public JSONObject datasourceDetail(JSONObject request) {
        return feignDataCloudService.getDatasourceDetail(requiredString(request, "baseId"),
            requiredString(request, "dbId", "datasourceId"), cacheMode(request));
    }

    public JSONObject createDatasource(JSONObject request) {
        return feignDataCloudService.createDatasource(requiredString(request, "baseId"), payload(request));
    }

    public JSONObject deleteDatasource(JSONObject request) {
        return feignDataCloudService.deleteDatasource(requiredString(request, "baseId"), requiredString(request, "dbId",
            "datasourceId"));
    }

    public JSONArray listActions(JSONObject request) {
        return feignDataCloudService.listActions(requiredString(request, "baseId"), requiredString(request, "objectCode"),
            cacheMode(request));
    }

    public JSONObject actionDetail(JSONObject request) {
        return feignDataCloudService.getActionDetail(requiredString(request, "baseId"),
            requiredString(request, "objectCode"), requiredString(request, "actionCode", "code"),
            cacheMode(request));
    }

    public JSONObject createAction(JSONObject request) {
        return feignDataCloudService.createAction(requiredString(request, "baseId"), requiredString(request,
            "objectCode"), payload(request));
    }

    public JSONObject updateAction(JSONObject request) {
        return feignDataCloudService.updateAction(requiredString(request, "baseId"),
            requiredString(request, "objectCode"), requiredString(request, "actionCode", "code"), payload(request));
    }

    public JSONObject deleteAction(JSONObject request) {
        return feignDataCloudService.deleteAction(requiredString(request, "baseId"),
            requiredString(request, "objectCode"), requiredString(request, "actionCode", "code"));
    }

    /**
     * 本体库 ss_resource 子树（库/场景/对象/视图），供"按粒度安装"选择器构建可勾选树并取 resourceId。
     */
    public List<SsResource> tree(String baseId) {
        List<Long> ids = resourceIdsOfBase(baseId);
        if (ids.isEmpty()) {
            return java.util.Collections.emptyList();
        }
        List<SsResource> rows = ssResourceMapper.selectBatchIds(ids);
        rows.sort(java.util.Comparator.comparing(SsResource::getParentResourceId,
            java.util.Comparator.nullsFirst(java.util.Comparator.naturalOrder())));
        return rows;
    }

    /** 取本体库下所有 ss_resource 资源 id：经扩展表 ss_res_ext_ontology.pid（= 本体库编码）过滤。 */
    private List<Long> resourceIdsOfBase(String baseId) {
        if (StringUtils.isBlank(baseId)) {
            return java.util.Collections.emptyList();
        }
        List<SsResExtOntology> exts = ssResExtOntologyMapper.selectByPid(baseId);
        if (exts == null || exts.isEmpty()) {
            return java.util.Collections.emptyList();
        }
        return exts.stream().map(SsResExtOntology::getResourceId).collect(Collectors.toList());
    }

    /**
     * 注册本体库：调 datacloud 创建/注册，再把库（LOCAL 时含场景/对象/视图子树）快照进 ss_resource。
     */
    @Transactional(rollbackFor = Exception.class)
    public SsResource registerBase(OntologyBaseRegisterRequest req) {
        String ownerType = normalizeOwnerType(req.getOwnerType());

        JSONObject body = new JSONObject();
        body.put("displayName", req.getDisplayName());
        body.put("description", req.getDescription());
        body.put("ownerType", ownerType);
        if (StringUtils.isNotBlank(req.getBaseId())) {
            body.put("baseId", req.getBaseId());
        }
        if (StringUtils.isNotBlank(req.getSourceUrl())) {
            body.put("sourceUrl", req.getSourceUrl());
        }
        if (StringUtils.isNotBlank(req.getAuthType())) {
            body.put("authType", req.getAuthType());
        }
        if (req.getAuthConfig() != null) {
            body.put("authConfig", req.getAuthConfig());
        }
        if (req.getTimeoutSec() != null) {
            body.put("timeoutSec", req.getTimeoutSec());
        }

        JSONObject created = feignDataCloudService.createOntologyBase(body);
        String baseId = firstNonBlank(created, "baseId", "base_id");
        if (StringUtils.isBlank(baseId)) {
            throw new BaseException("注册本体库失败：datacloud 未返回 baseId");
        }

        String sourceType = StringUtils.defaultIfBlank(firstNonBlank(created, "sourceType", "source_type"), LOCAL);
        String displayName = StringUtils.defaultIfBlank(firstNonBlank(created, "displayName", "display_name"),
            req.getDisplayName());
        String description = StringUtils.defaultIfBlank(firstNonBlank(created, "description"), req.getDescription());

        SsResource baseRes = insertOntologyResource(ResourceBizType.ONTOLOGY_BASE.getCode(), displayName, description,
            baseId, baseId, ROOT_PARENT_ID, ownerType, sourceType, created, req.getCatalogId(), null);

        if (LOCAL.equalsIgnoreCase(sourceType)) {
            try {
                snapshotSubtree(baseRes, ownerType, baseId, sourceType);
            }
            catch (Exception e) {
                // 子树快照失败不阻断库级注册，记录日志后续可重建。
                logger.error("snapshot ontology subtree failed, baseId={}", baseId, e);
            }
        }
        return baseRes;
    }

    /**
     * 刷新企业本体库：从本体管理门户（datacloud listOntologyBases）拉取全部本体库，按 resource_code=baseId
     * 在「该 ownerType + ONTOLOGY_BASE」范围内 upsert（存在则更新、不存在则新增，只落库级不快照子树）；
     * 远程已删、本地残留的置 resource_status=3（已下架）。返回汇总 + 明细。
     */
    @Transactional(rollbackFor = Exception.class)
    public OntologyRefreshResult refreshEnterpriseBases(String ownerType) {
        assertEnterpriseAdmin();
        String owner = normalizeOwnerType(ownerType);
        OntologyRefreshResult result = new OntologyRefreshResult();
        // 企业刷新统一以平台管理员 adminvip（id=10001）作为创建者/更新者
        Long adminUserId = ADMIN_VIP_USER_ID;

        // 本地现有的本体库（限定 ownerType + ONTOLOGY_BASE），按 resource_code 建索引
        LambdaQueryWrapper<SsResource> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(SsResource::getResourceBizType, ResourceBizType.ONTOLOGY_BASE.getCode());
        wrapper.eq(SsResource::getOwnerType, owner);
        List<SsResource> existingList = ssResourceMapper.selectList(wrapper);
        Map<String, SsResource> existingByCode = new HashMap<>();
        for (SsResource res : existingList) {
            if (StringUtils.isNotBlank(res.getResourceCode())) {
                existingByCode.putIfAbsent(res.getResourceCode(), res);
            }
        }

        JSONArray bases = feignDataCloudService.listOntologyBases();
        Set<String> remoteIds = new HashSet<>();
        if (bases != null) {
            for (int i = 0; i < bases.size(); i++) {
                JSONObject base = bases.getJSONObject(i);
                String baseId = firstNonBlank(base, "baseId", "base_id");
                if (StringUtils.isBlank(baseId)) {
                    continue;
                }
                remoteIds.add(baseId);
                String displayName = StringUtils.defaultIfBlank(firstNonBlank(base, "displayName", "display_name"),
                    baseId);
                String description = firstNonBlank(base, "description");
                String sourceType = StringUtils.defaultIfBlank(firstNonBlank(base, "sourceType", "source_type"), REMOTE);

                SsResource exist = existingByCode.get(baseId);
                if (exist != null) {
                    // 更新：名称/描述/状态置回已上架 + 刷新扩展表镜像；更新者记为 adminvip
                    exist.setResourceName(displayName);
                    exist.setResourceDesc(description);
                    exist.setResourceStatus(ResourceStatus.LIST.getNum());
                    exist.setHostType(REMOTE.equalsIgnoreCase(sourceType) ? "hosted" : "local");
                    exist.setUpdateBy(adminUserId);
                    ssResourceService.updateResourceEntity(exist);
                    ssResExtOntologyMapper.deleteByResourceId(exist.getResourceId());
                    SsResExtOntology ext = new SsResExtOntology();
                    ext.setResourceId(exist.getResourceId());
                    ext.setPid(baseId);
                    ext.setTargetContent(JSON.toJSONString(base));
                    ssResExtOntologyMapper.insert(ext);
                    result.setUpdated(result.getUpdated() + 1);
                    result.addDetail(baseId, displayName, "update");
                }
                else {
                    insertOntologyResource(ResourceBizType.ONTOLOGY_BASE.getCode(), displayName, description, baseId,
                        baseId, ROOT_PARENT_ID, owner, sourceType, base, null, adminUserId);
                    result.setAdded(result.getAdded() + 1);
                    result.addDetail(baseId, displayName, "insert");
                }
            }
        }

        // 远程门户已删、本地仍在的 → 下架（resource_status=3）；更新者记为 adminvip
        Integer removed = ResourceStatus.REMOVED.getNum();
        for (SsResource exist : existingList) {
            if (!remoteIds.contains(exist.getResourceCode()) && !removed.equals(exist.getResourceStatus())) {
                exist.setResourceStatus(removed);
                exist.setUpdateBy(adminUserId);
                ssResourceService.updateResourceEntity(exist);
                result.setOffline(result.getOffline() + 1);
                result.addDetail(exist.getResourceCode(), exist.getResourceName(), "offline");
            }
        }

        result.setTotal(remoteIds.size());
        return result;
    }

    /** 把本体库的场景/对象/视图快照成 ss_resource 树。 */
    private void snapshotSubtree(SsResource baseRes, String ownerType, String baseId, String sourceType) {
        JSONArray scenes = feignDataCloudService.listScenes(ownerType, baseId, null);
        if (scenes == null) {
            return;
        }
        for (int i = 0; i < scenes.size(); i++) {
            JSONObject scene = scenes.getJSONObject(i);
            String sceneId = firstNonBlank(scene, "sceneId", "scene_id");
            if (StringUtils.isBlank(sceneId)) {
                continue;
            }
            String sceneName = StringUtils.defaultIfBlank(firstNonBlank(scene, "sceneName", "scene_name"), sceneId);
            SsResource sceneRes = insertOntologyResource(ResourceBizType.SCENE.getCode(), sceneName,
                firstNonBlank(scene, "sceneDesc", "scene_desc"), sceneId, baseId, baseRes.getResourceId(), ownerType,
                sourceType, scene, null, null);

            JSONObject detail = feignDataCloudService.getSceneDetails(ownerType, baseId, sceneId);
            if (detail == null) {
                continue;
            }
            JSONArray objects = detail.getJSONArray("objects");
            if (objects != null) {
                for (int j = 0; j < objects.size(); j++) {
                    JSONObject obj = objects.getJSONObject(j);
                    String code = firstNonBlank(obj, "objectCode", "object_code");
                    if (StringUtils.isBlank(code)) {
                        continue;
                    }
                    insertOntologyResource(ResourceBizType.OBJECT.getCode(),
                        StringUtils.defaultIfBlank(firstNonBlank(obj, "objectName", "object_name"), code),
                        firstNonBlank(obj, "objectDesc", "object_desc"),
                        code, baseId, sceneRes.getResourceId(), ownerType, sourceType, obj, null, null);
                }
            }
            JSONArray views = detail.getJSONArray("views");
            if (views != null) {
                for (int j = 0; j < views.size(); j++) {
                    JSONObject view = views.getJSONObject(j);
                    String code = firstNonBlank(view, "viewCode", "view_code");
                    if (StringUtils.isBlank(code)) {
                        continue;
                    }
                    insertOntologyResource(ResourceBizType.VIEW.getCode(),
                        StringUtils.defaultIfBlank(firstNonBlank(view, "viewName", "view_name"), code),
                        firstNonBlank(view, "description", "view_desc"),
                        code, baseId, sceneRes.getResourceId(), ownerType, sourceType, view, null, null);
                }
            }
        }
    }

    /**
     * 建一行本体 ss_resource + 扩展表（target_content 存元数据明细镜像）。
     *
     * @param catalogId 所属资源目录（仅库级注册时传入；为 null 时由 createResource 默认 0）
     * @param operatorId 创建者/更新者用户 id（企业刷新时写死 adminvip；为 null 时由 fillCreateDefaults 取当前用户）
     */
    private SsResource insertOntologyResource(String bizType, String name, String desc, String code, String baseCode,
        Long parentId, String ownerType, String sourceType, JSONObject detail, Long catalogId, Long operatorId) {
        // 只预设 ontology 专用字段 + 业务状态；resourceId/审计/发布/归属等公共默认
        // 交给 ssResourceService.createResource → fillCreateDefaults 统一补齐（与全站资源一致）。
        SsResource res = new SsResource();
        res.setResourceName(name);
        res.setResourceDesc(desc);
        res.setResourceBizType(bizType);
        res.setResourceCode(code);
        res.setResourceType(RESOURCE_TYPE_ATOM);
        res.setSystemCode(SYSTEM_CODE_DATACLOUD);
        res.setOwnerType(ownerType);
        res.setResourceStatus(ResourceStatus.LIST.getNum()); // 2 已上架
        res.setResourceVersionId("1.0"); // createResource 规整为 "1.0.0"
        res.setParentResourceId(parentId);
        res.setHostType(REMOTE.equalsIgnoreCase(sourceType) ? "hosted" : "local");
        res.setImplType("ASK_AGENT");
        res.setWorkerAgentType("BYCLAW_DATA");
        if (catalogId != null) {
            res.setCatalogId(catalogId);
        }
        if (operatorId != null) {
            res.setCreateBy(operatorId);
            res.setUpdateBy(operatorId);
        }
        SsResource saved = ssResourceService.createResource(res);

        SsResExtOntology ext = new SsResExtOntology();
        ext.setResourceId(saved.getResourceId());
        ext.setPid(baseCode);
        if (detail != null) {
            ext.setTargetContent(JSON.toJSONString(detail));
        }
        ssResExtOntologyMapper.insert(ext);
        initializePersonalOntologyPrivileges(saved, ownerType);
        return saved;
    }

    private void initializePersonalOntologyPrivileges(SsResource resource, String ownerType) {
        if (resource == null || !OwnerType.PERSONAL.equals(ownerType)) {
            return;
        }
        authApplicationService.ensureCreatorDefaultPrivileges(resource);
    }

    /** 注销本体库：调 datacloud 删除，并级联清理 ss_resource 子树及扩展表。 */
    @Transactional(rollbackFor = Exception.class)
    public boolean deleteBase(String ownerType, String baseId) {
        if (StringUtils.isBlank(baseId)) {
            throw new BaseException("baseId 不能为空");
        }
        feignDataCloudService.deleteOntologyBase(normalizeOwnerType(ownerType), baseId);

        List<Long> ids = resourceIdsOfBase(baseId);
        if (!ids.isEmpty()) {
            ssResExtOntologyMapper.deleteByResourceIds(ids);
            ssResourceMapper.deleteBatchIds(ids);
        }
        return true;
    }

    private String normalizeOwnerType(String ownerType) {
        return StringUtils.isBlank(ownerType) ? "personal" : ownerType;
    }

    /**
     * 校验刷新企业本体库的权限：仅平台/业务/组织管理员或超管(adminvip)可操作，与「企业 tab 创建资源」同一角色集。
     */
    private void assertEnterpriseAdmin() {
        boolean allowed = CurrentUserHolder.isBusinessAdmin() || CurrentUserHolder.isOrganizationAdmin()
            || CurrentUserHolder.isPlatformManager()
            || ADMIN_VIP_USER_CODE.equalsIgnoreCase(CurrentUserHolder.getCurrentUserCode());
        if (!allowed) {
            throw new BaseException("无权限：仅管理员可刷新企业本体库");
        }
    }

    private String keyword(JSONObject request) {
        return StringUtils.defaultIfBlank(request.getString("keyword"), request.getString("queryKeyword"));
    }

    private String cacheMode(JSONObject request) {
        return StringUtils.defaultIfBlank(request.getString("cacheMode"), request.getString("cache_mode"));
    }

    private String requiredString(JSONObject request, String... keys) {
        for (String key : keys) {
            String value = request.getString(key);
            if (StringUtils.isNotBlank(value)) {
                return value;
            }
        }
        throw new BaseException(String.join("/", keys) + " 不能为空");
    }

    @SuppressWarnings("unchecked")
    private JSONObject payload(JSONObject request) {
        Object nestedPayload = request.get("payload");
        if (nestedPayload instanceof JSONObject) {
            return (JSONObject) nestedPayload;
        }
        if (nestedPayload instanceof Map) {
            JSONObject nested = new JSONObject();
            nested.putAll((Map<String, Object>) nestedPayload);
            return nested;
        }

        JSONObject body = new JSONObject();
        body.putAll(request);
        body.remove("ownerType");
        body.remove("sceneId");
        body.remove("dbId");
        body.remove("datasourceId");
        body.remove("keyword");
        body.remove("queryKeyword");
        body.remove("cacheMode");
        body.remove("cache_mode");
        body.remove("page");
        body.remove("pageSize");
        body.remove("payload");
        return body;
    }

    /** 取首个非空字段值，兼容 datacloud 响应的 snake_case 与 camelCase 两种键名。 */
    private static String firstNonBlank(JSONObject obj, String... keys) {
        if (obj == null) {
            return null;
        }
        for (String key : keys) {
            String value = obj.getString(key);
            if (StringUtils.isNotBlank(value)) {
                return value;
            }
        }
        return null;
    }
}
