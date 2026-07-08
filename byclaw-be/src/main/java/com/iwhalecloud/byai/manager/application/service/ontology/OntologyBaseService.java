package com.iwhalecloud.byai.manager.application.service.ontology;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.feign.client.FeignDataCloudService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantType;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.request.ResourceUseAuthQo;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceAuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyBaseRegisterRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyRefreshResult;
import com.iwhalecloud.byai.manager.entity.ontology.SsResExtOntology;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtObject;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtScene;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtView;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.ontology.SsResExtOntologyMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtObjectMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtSceneMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtViewMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.vo.auth.ResourceAuthVo;
import com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo;
import java.util.ArrayList;
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
 * ONTOLOGY_BASE/SCENE/OBJECT/VIEW + parentResourceId 树；本体库、场景、对象、视图分别写各自扩展表），供门户浏览与数字员工绑定。
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

    @Autowired
    private ResourceAuthApplicationService resourceAuthApplicationService;

    @Autowired
    private SsResExtSceneMapper ssResExtSceneMapper;

    @Autowired
    private SsResExtViewMapper ssResExtViewMapper;

    @Autowired
    private SsResExtObjectMapper ssResExtObjectMapper;

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
    public JSONObject objectDetail(JSONObject request) {
        return feignDataCloudService.getObjectDetailByObjectCode(requiredString(request, "objectCode", "object_code",
            "code"));
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

    public JSONArray listObjectsByViewCode(JSONObject request) {
        return feignDataCloudService.listObjectsByViewCode(requiredString(request, "viewCode", "view_code", "code"));
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

    public JSONObject pageResources(JSONObject request) {
        return pageLocalResources(request);
    }

    public boolean canSyncEnterpriseResources() {
        return isAdminVipUser();
    }

    public JSONObject syncResources(JSONObject request) {
        String ownerType = normalizeOwnerType(request.getString("ownerType"));
        String userCode = resolveSyncUserCode(ownerType, request.getString("userCode"));
        String keyword = keyword(request);
        Integer pageNum = defaultNumber(request.getInteger("pageNum"), request.getInteger("page"), 1);
        Integer pageSize = defaultNumber(request.getInteger("pageSize"), request.getInteger("size"), 20);
        Set<String> bizTypes = resourceBizTypes(request);
        String sceneCode = request.getString("catalogId");
        if (StringUtils.isBlank(sceneCode)) {
            throw new BaseException("catalogId 不能为空");
        }

        String type = datacloudOntologyType(bizTypes);
        JSONObject page = feignDataCloudService.queryOntologiesBySceneCode(sceneCode, ownerType, type, keyword,
            pageNum, pageSize, userCode);
        JSONObject normalizedPage = normalizeSceneOntologyPage(page, ownerType, sceneCode, type, pageNum, pageSize);
        JSONArray rows = filterPersonalRowsByUserCode(normalizedPage.getJSONArray("rows"), ownerType, userCode);
        normalizedPage.put("rows", rows);
        int created = 0;
        int updated = 0;
        if (rows != null) {
            for (Object item : rows) {
                JSONObject row = toJson(item);
                String action = upsertSyncedResource(row, ownerType, sceneCode);
                if ("created".equals(action)) {
                    created++;
                }
                else if ("updated".equals(action)) {
                    updated++;
                }
            }
        }

        JSONObject pageInfo = normalizedPage.getJSONObject("pageInfo");
        int total = pageInfo == null ? rows == null ? 0 : rows.size() : pageInfo.getIntValue("total");
        int totalPages = pageInfo == null ? 0 : pageInfo.getIntValue("totalPages");
        int rowCount = rows == null ? 0 : rows.size();
        boolean hasMore = totalPages > pageNum || (totalPages <= 1 && rowCount >= Math.max(pageSize, 1));

        JSONObject result = new JSONObject();
        result.put("pageNum", pageNum);
        result.put("pageSize", pageSize);
        result.put("total", total);
        result.put("totalPages", totalPages);
        result.put("batchTotal", totalPages);
        result.put("batchNo", pageNum);
        result.put("batchSize", rowCount);
        result.put("created", created);
        result.put("updated", updated);
        result.put("synced", created + updated);
        result.put("hasMore", hasMore);
        result.put("rows", rows == null ? new JSONArray() : rows);
        return result;
    }

    private JSONArray filterPersonalRowsByUserCode(JSONArray rows, String ownerType, String currentUserCode) {
        if (!OwnerType.PERSONAL.equals(ownerType) || rows == null || rows.isEmpty()) {
            return rows == null ? new JSONArray() : rows;
        }
        JSONArray filteredRows = new JSONArray();
        int skipped = 0;
        for (Object item : rows) {
            JSONObject row = toJson(item);
            String rowUserCode = datacloudUserCode(row);
            if (StringUtils.equals(rowUserCode, currentUserCode)) {
                filteredRows.add(row);
                continue;
            }
            skipped++;
            logger.info("skip personal datacloud ontology row, currentUserCode={}, rowUserCode={}, resourceCode={}",
                currentUserCode, rowUserCode, firstNonBlank(row, "resourceCode", "viewCode", "objectCode", "code"));
        }
        if (skipped > 0) {
            logger.info("filtered personal datacloud ontology rows, currentUserCode={}, kept={}, skipped={}",
                currentUserCode, filteredRows.size(), skipped);
        }
        return filteredRows;
    }

    private String resolveSyncUserCode(String ownerType, String requestUserCode) {
        if (OwnerType.ENTERPRISE.equals(ownerType)) {
            ensureEnterpriseOntologyRefreshPermission();
            return null;
        }
        if (!OwnerType.PERSONAL.equals(ownerType)) {
            return StringUtils.defaultIfBlank(requestUserCode, CurrentUserHolder.getCurrentUserCode());
        }
        String currentUserCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(currentUserCode)) {
            throw new BaseException("当前登录用户编码不能为空");
        }
        return currentUserCode;
    }

    private void ensureEnterpriseOntologyRefreshPermission() {
        if (!isAdminVipUser()) {
            throw new BaseException("只有 adminvip 可以刷新企业本体资源");
        }
    }

    private boolean isAdminVipUser() {
        return ADMIN_VIP_USER_CODE.equalsIgnoreCase(CurrentUserHolder.getCurrentUserCode());
    }

    private JSONObject pageLocalResources(JSONObject request) {
        Integer pageNum = defaultNumber(request.getInteger("pageNum"), request.getInteger("page"), 1);
        Integer pageSize = defaultNumber(request.getInteger("pageSize"), request.getInteger("size"), 20);

        ResourceUseAuthQo query = new ResourceUseAuthQo();
        query.setOwnerType(normalizeOwnerType(request.getString("ownerType")));
        query.setKeyword(keyword(request));
        query.setResourceBizTypeList(new ArrayList<>(resourceBizTypes(request)));
        query.setResourceStatus(resourceStatus(request));
        query.setPermission(request.getString("permission"));
        query.setCatalogId(catalogIdAsLong(request.get("catalogId")));
        query.setPageNum(Math.max(pageNum == null ? 1 : pageNum, 1));
        query.setPageSize(Math.max(pageSize == null ? 20 : pageSize, 1));
        if (OwnerType.ENTERPRISE.equals(query.getOwnerType())) {
            query.setIncludeAllEnterpriseOwnerType(true);
        }

        PageInfo<ResourceAuthVo> page = resourceAuthApplicationService.listResourceAuth(query);
        List<ResourceAuthVo> rows = page.getList() == null ? new ArrayList<>() : page.getList();
        fillOperationPermissions(rows);
        enrichOntologyTargetContent(rows);

        JSONObject pageInfo = new JSONObject();
        pageInfo.put("pageNum", page.getPageNum());
        pageInfo.put("pageSize", page.getPageSize());
        pageInfo.put("total", page.getTotal());
        pageInfo.put("totalPages", page.getTotalPages());

        JSONObject result = new JSONObject();
        result.put("rows", rows);
        result.put("list", rows);
        result.put("pageInfo", pageInfo);
        result.put("total", page.getTotal());
        return result;
    }

    private void fillOperationPermissions(List<ResourceAuthVo> rows) {
        if (rows == null || rows.isEmpty()) {
            return;
        }
        List<Long> resourceIds = rows.stream()
            .filter(row -> row != null && row.getResourceId() != null)
            .map(ResourceAuthVo::getResourceId)
            .distinct()
            .collect(Collectors.toList());
        Map<Long, ResourceOperationPermissionsVo> permissionMap =
            authApplicationService.queryResourceOperationPermissionsBatch(resourceIds);
        rows.forEach(row -> {
            if (row == null || row.getResourceId() == null) {
                return;
            }
            ResourceOperationPermissionsVo permissions = permissionMap.get(row.getResourceId());
            if (permissions == null) {
                return;
            }
            row.setCanEdit(permissions.getCanEdit());
            row.setCanManageAuth(permissions.getCanManageAuth());
            row.setCanUseAuth(permissions.getCanUseAuth());
            row.setCanDelete(permissions.getCanDelete());
            row.setCanApplyUse(permissions.getCanApplyUse());
            row.setCanAuditUse(permissions.getCanAuditUse());
        });
    }

    private String upsertSyncedResource(JSONObject row, String ownerType, String sceneCode) {
        String bizType = normalizeOntologyBizType(row.getString("resourceBizType"), row);
        String resourceCode = ResourceBizType.VIEW.name().equals(bizType)
            ? firstNonBlank(row, "viewCode", "view_code", "resourceCode", "resource_code", "code", "id")
            : firstNonBlank(row, "objectCode", "object_code", "resourceCode", "resource_code", "code", "id");
        String resourceName = ResourceBizType.VIEW.name().equals(bizType)
            ? firstNonBlank(row, "viewName", "view_name", "resourceName", "resource_name", "name", "displayName")
            : firstNonBlank(row, "objectName", "object_name", "resourceName", "resource_name", "name", "displayName");
        String baseCode = ontologyBaseCode(row);
        String rowSceneCode = sceneCode(row, sceneCode);
        if (StringUtils.isBlank(resourceCode) || StringUtils.isBlank(resourceName)) {
            return "skipped";
        }

        SsResource existing = findSyncedResource(resourceCode, bizType, ownerType, baseCode, rowSceneCode);
        if (existing == null) {
            SsResource created = new SsResource();
            fillSyncedResource(created, row, ownerType, sceneCode, bizType, resourceCode, resourceName);
            SsResource saved = ssResourceService.saveResource(created);
            replaceSyncedExt(saved.getResourceId(), bizType,
                buildOntologyMeta(bizType, baseCode, resourceCode, resourceName, saved.getResourceDesc(), ownerType,
                    row));
            return "created";
        }

        ensureCanUpdateExistingResource(existing, resourceCode);
        fillSyncedResource(existing, row, ownerType, sceneCode, bizType, resourceCode, resourceName);
        ssResourceService.updateResourceEntity(existing);
        replaceSyncedExt(existing.getResourceId(), bizType,
            buildOntologyMeta(bizType, baseCode, resourceCode, resourceName, existing.getResourceDesc(), ownerType,
                row));
        return "updated";
    }

    private SsResource findSyncedResource(String resourceCode, String bizType, String ownerType, String baseCode,
        String sceneCode) {
        return ssResourceService.findUniqueBySystemCodeAndBizTypeAndResourceCode(SYSTEM_CODE_DATACLOUD, bizType,
            resourceCode);
    }

    private void ensureCanUpdateExistingResource(SsResource existing, String resourceCode) {
        if (existing == null || authApplicationService.hasResourceManagePermission(existing)) {
            return;
        }
        throw new BaseException("当前用户对资源【" + StringUtils.defaultIfBlank(existing.getResourceName(), resourceCode)
            + "】没有管理权限，不能更新该资源");
    }

    private void fillSyncedResource(SsResource resource, JSONObject row, String ownerType, String sceneCode,
        String bizType, String resourceCode, String resourceName) {
        resource.setResourceBizType(bizType);
        resource.setResourceCode(resourceCode);
        resource.setResourceName(resourceName);
        resource.setResourceDesc(firstNonBlank(row, "resourceDesc", "resource_desc", "description", "desc",
            "viewDesc", "view_desc", "objectDesc", "object_desc"));
        resource.setResourceType(RESOURCE_TYPE_ATOM);
        resource.setSystemCode(SYSTEM_CODE_DATACLOUD);
        resource.setOwnerType(StringUtils.defaultIfBlank(row.getString("ownerType"), ownerType));
        resource.setResourceStatus(ResourceStatus.LIST.getNum());
        resource.setResourceVersionId("1.0");
        resource.setParentResourceId(ROOT_PARENT_ID);
        resource.setHostType("local");
        resource.setImplType("ASK_AGENT");
        resource.setWorkerAgentType("BYCLAW_DATA");
        Long catalog = catalogIdAsLong(row.get("catalogId"));
        if (catalog == null) {
            catalog = catalogIdAsLong(sceneCode);
        }
        if (catalog != null) {
            resource.setCatalogId(catalog);
        }
    }

    private String resourceStatus(JSONObject request) {
        JSONArray statusList = request.getJSONArray("statusList");
        if (statusList == null || statusList.isEmpty()) {
            return String.valueOf(ResourceStatus.LIST.getNum());
        }
        List<Integer> values = new ArrayList<>();
        for (Object item : statusList) {
            if (item != null) {
                values.add(Integer.valueOf(String.valueOf(item)));
            }
        }
        if (values.isEmpty()) {
            return String.valueOf(ResourceStatus.LIST.getNum());
        }
        return values.size() == 1 ? String.valueOf(values.get(0)) : "";
    }

    private Long catalogIdAsLong(Object catalogId) {
        if (catalogId == null || StringUtils.isBlank(String.valueOf(catalogId))) {
            return null;
        }
        try {
            return Long.valueOf(String.valueOf(catalogId));
        }
        catch (NumberFormatException e) {
            return null;
        }
    }

    private void enrichOntologyTargetContent(List<ResourceAuthVo> rows) {
        if (rows == null || rows.isEmpty()) {
            return;
        }
        for (ResourceAuthVo row : rows) {
            if (row == null || row.getResourceId() == null || !isOntologyChildBizType(row.getResourceBizType())) {
                continue;
            }
            JSONObject meta = ontologyTargetContent(row.getResourceId(), row.getResourceBizType());
            if (!meta.isEmpty()) {
                row.setTargetContent(JSON.toJSONString(meta));
            }
        }
    }

    private JSONObject ontologyTargetContent(SsResource resource) {
        if (resource == null || resource.getResourceId() == null) {
            return new JSONObject();
        }
        return ontologyTargetContent(resource.getResourceId(), resource.getResourceBizType());
    }

    private JSONObject ontologyTargetContent(Long resourceId, String bizType) {
        if (resourceId == null) {
            return new JSONObject();
        }
        String targetContent = null;
        if (ResourceBizType.VIEW.getCode().equals(bizType)) {
            SsResExtView ext = ssResExtViewMapper.selectById(resourceId);
            targetContent = ext == null ? null : ext.getTargetContent();
        }
        else if (ResourceBizType.OBJECT.getCode().equals(bizType)) {
            SsResExtObject ext = ssResExtObjectMapper.selectById(resourceId);
            targetContent = ext == null ? null : ext.getTargetContent();
        }
        else if (ResourceBizType.SCENE.getCode().equals(bizType)) {
            SsResExtScene ext = ssResExtSceneMapper.selectById(resourceId);
            targetContent = ext == null ? null : ext.getTargetContent();
        }
        if (StringUtils.isBlank(targetContent)) {
            return new JSONObject();
        }
        try {
            return JSON.parseObject(targetContent);
        }
        catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private void replaceSyncedExt(Long resourceId, String bizType, JSONObject targetContent) {
        if (resourceId == null || targetContent == null) {
            return;
        }
        String targetJson = JSON.toJSONString(targetContent);
        if (ResourceBizType.VIEW.getCode().equals(bizType)) {
            SsResExtView ext = ssResExtViewMapper.selectById(resourceId);
            if (ext == null) {
                ext = new SsResExtView();
                ext.setResourceId(resourceId);
                ext.setTargetContent(targetJson);
                ssResExtViewMapper.insert(ext);
                return;
            }
            ext.setTargetContent(targetJson);
            ssResExtViewMapper.updateById(ext);
            return;
        }
        if (ResourceBizType.OBJECT.getCode().equals(bizType)) {
            SsResExtObject ext = ssResExtObjectMapper.selectById(resourceId);
            if (ext == null) {
                ext = new SsResExtObject();
                ext.setResourceId(resourceId);
                ext.setTargetContent(targetJson);
                ssResExtObjectMapper.insert(ext);
                return;
            }
            ext.setTargetContent(targetJson);
            ssResExtObjectMapper.updateById(ext);
        }
    }

    private JSONObject normalizeSceneOntologyPage(JSONObject page, String ownerType, String sceneCode, String type,
        Integer pageNum, Integer pageSize) {
        JSONObject source = page == null ? new JSONObject() : page;
        JSONObject pageSource = pagePayload(source);
        JSONArray rows = sceneOntologyRows(pageSource, type);
        JSONArray normalizedRows = new JSONArray();
        if (rows != null) {
            for (Object item : rows) {
                JSONObject row = toJson(item);
                String rowType = StringUtils.defaultIfBlank(type, firstNonBlank(row, "resourceBizType", "type"));
                String bizType = normalizeOntologyBizType(rowType, row);
                String resourceCode = ResourceBizType.VIEW.name().equals(bizType)
                    ? firstNonBlank(row, "viewCode", "view_code", "resourceCode", "resource_code", "code", "id")
                    : firstNonBlank(row, "objectCode", "object_code", "resourceCode", "resource_code", "code", "id");
                String resourceName = ResourceBizType.VIEW.name().equals(bizType)
                    ? firstNonBlank(row, "viewName", "view_name", "resourceName", "resource_name", "name",
                        "displayName")
                    : firstNonBlank(row, "objectName", "object_name", "resourceName", "resource_name", "name",
                        "displayName");
                String baseCode = ontologyBaseCode(row);
                String baseName = ontologyBaseName(row);
                String rowSceneCode = sceneCode(row, sceneCode);
                String rowSceneName = sceneName(row);

                row.put("ownerType", ownerType);
                row.put("catalogId", sceneCode);
                row.put("baseId", baseCode);
                row.put("baseName", baseName);
                row.put("ontologyBaseCode", baseCode);
                row.put("ontologyBaseName", baseName);
                row.put("sceneId", rowSceneCode);
                row.put("sceneCode", rowSceneCode);
                row.put("sceneName", rowSceneName);
                row.put("resourceBizType", bizType);
                row.put("resourceCode", resourceCode);
                row.put("resourceName", resourceName);
                row.put("resourceDesc", firstNonBlank(row, "resourceDesc", "description", "desc", "viewDesc",
                    "objectDesc"));
                if (ResourceBizType.VIEW.name().equals(bizType)) {
                    row.put("viewCode", resourceCode);
                    row.put("viewName", resourceName);
                }
                else {
                    row.put("objectCode", resourceCode);
                    row.put("objectName", resourceName);
                }
                normalizedRows.add(row);
            }
        }

        int total = firstInt(pageSource, normalizedRows.size(), "total", "totalCount", "count");
        int safePageNum = Math.max(pageNum == null ? firstInt(pageSource, 1, "pageNum", "page") : pageNum, 1);
        int safePageSize = Math.max(pageSize == null ? firstInt(pageSource, 20, "pageSize", "size") : pageSize, 1);

        JSONObject pageInfo = new JSONObject();
        pageInfo.put("pageNum", safePageNum);
        pageInfo.put("pageSize", safePageSize);
        pageInfo.put("total", total);
        pageInfo.put("totalPages", firstInt(pageSource, (total + safePageSize - 1) / safePageSize, "totalPages",
            "pages"));

        JSONObject result = new JSONObject();
        result.put("rows", normalizedRows);
        result.put("list", normalizedRows);
        result.put("pageInfo", pageInfo);
        result.put("total", total);
        return result;
    }

    public JSONObject viewDetail(JSONObject request) {
        return feignDataCloudService.getViewDetailByViewCode(requiredString(request, "viewCode", "view_code", "code"));
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

    public JSONArray listRelationsByObjectCode(JSONObject request) {
        return feignDataCloudService.listRelationsByObjectCode(requiredString(request, "objectCode", "object_code",
            "code"));
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

    /**
     * 挂载数字员工时，场景/对象/视图可能还只存在于 datacloud，未落入 ss_resource。
     * 仅允许资源化当前用户自己创建的本体库下的子资源，避免越权把企业或他人本体资源写成本地资源。
     */
    @Transactional(rollbackFor = Exception.class)
    public SsResource ensureCurrentUserOntologyChildResource(String bizType, String baseId, String code) {
        if (!isOntologyChildBizType(bizType) || StringUtils.isBlank(baseId) || StringUtils.isBlank(code)) {
            return null;
        }
        SsResource existing = findSingleOntologyResource(code, bizType, baseId);
        if (existing != null) {
            return existing;
        }

        SsResource baseRes = findCurrentUserCreatedBase(baseId);
        if (baseRes == null) {
            return null;
        }
        return ensureOntologyChildResource(baseRes, bizType, code);
    }

    /**
     * 按指定本体库资源，将 datacloud 中存在的场景/视图/对象按需快照为门户资源索引。
     * 调用方负责完成本体库访问权限校验。
     */
    @Transactional(rollbackFor = Exception.class)
    public SsResource ensureOntologyChildResource(SsResource baseRes, String bizType, String code) {
        if (baseRes == null || !isOntologyChildBizType(bizType) || StringUtils.isBlank(code)) {
            return null;
        }
        String baseId = baseRes.getResourceCode();
        if (StringUtils.isBlank(baseId)) {
            return null;
        }
        SsResource existing = findSingleOntologyResource(code, bizType, baseId);
        if (existing != null) {
            return existing;
        }
        String ownerType = normalizeOwnerType(baseRes.getOwnerType());
        String sourceType = sourceTypeOfBase(baseRes);

        if (ResourceBizType.SCENE.getCode().equals(bizType)) {
            JSONObject scene = findSceneSummary(ownerType, baseId, code);
            JSONObject detail = safeSceneDetail(ownerType, baseId, code);
            JSONObject meta = mergeDetails(scene, detail);
            if (meta.isEmpty()) {
                return null;
            }
            SsResource saved = insertOntologyResource(ResourceBizType.SCENE.getCode(),
                StringUtils.defaultIfBlank(firstNonBlank(meta, "sceneName", "scene_name", "name", "displayName"), code),
                firstNonBlank(meta, "sceneDesc", "scene_desc", "description"), code, baseId,
                baseRes.getResourceId(), ownerType, sourceType, meta, null, baseRes.getCreateBy());
            grantCurrentUserOntologyChildPrivileges(baseRes, saved);
            return saved;
        }

        OntologyChildContext context = findChildSceneContext(ownerType, baseId, code,
            ResourceBizType.OBJECT.getCode().equals(bizType) ? "objects" : "views",
            ResourceBizType.OBJECT.getCode().equals(bizType)
                ? new String[] {"objectCode", "object_code"}
                : new String[] {"viewCode", "view_code"});
        JSONObject detail = ResourceBizType.OBJECT.getCode().equals(bizType)
            ? safeObjectDetail(code)
            : safeViewDetail(code);
        JSONObject meta = mergeDetails(context == null ? null : context.child, detail);
        if (meta.isEmpty()) {
            return null;
        }
        SsResource parent = context == null ? baseRes
            : ensureSceneResource(baseRes, ownerType, baseId, sourceType, context.scene);
        if (parent == null) {
            parent = baseRes;
        }

        if (ResourceBizType.OBJECT.getCode().equals(bizType)) {
            SsResource saved = insertOntologyResource(ResourceBizType.OBJECT.getCode(),
                StringUtils.defaultIfBlank(firstNonBlank(meta, "objectName", "object_name", "name", "displayName"),
                    code),
                firstNonBlank(meta, "objectDesc", "object_desc", "description"), code, baseId,
                parent.getResourceId(), ownerType, sourceType, meta, null, baseRes.getCreateBy());
            grantCurrentUserOntologyChildPrivileges(baseRes, saved);
            return saved;
        }
        SsResource saved = insertOntologyResource(ResourceBizType.VIEW.getCode(),
            StringUtils.defaultIfBlank(firstNonBlank(meta, "viewName", "view_name", "name", "displayName"), code),
            firstNonBlank(meta, "viewDesc", "view_desc", "description"), code, baseId,
            parent.getResourceId(), ownerType, sourceType, meta, null, baseRes.getCreateBy());
        grantCurrentUserOntologyChildPrivileges(baseRes, saved);
        return saved;
    }

    /** 取本体库下所有 ss_resource 资源 id：本体库/场景/视图/对象分别按各自扩展表过滤。 */
    private List<Long> resourceIdsOfBase(String baseId) {
        if (StringUtils.isBlank(baseId)) {
            return java.util.Collections.emptyList();
        }
        return ssResourceService.findOntologyResourceIdsByBaseCode(baseId);
    }

    /**
     * 注册本体库：调 datacloud 创建/注册，门户只落本体库级资源；场景/视图/对象由 datacloud 维护，
     * 门户仅在绑定/挂载时按需创建资源索引。
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

        return baseRes;
    }

    /**
     * 刷新企业本体库：从本体管理门户按 ownerType 拉取本体库，按 resource_code=baseId
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

        JSONArray bases = feignDataCloudService.listOntologyBases(owner, null);
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
                    replaceOntologyBaseExt(exist.getResourceId(), baseId, buildOntologyMeta(
                        ResourceBizType.ONTOLOGY_BASE.getCode(), baseId, baseId, null, null, null, base));
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

    private SsResource findSingleOntologyResource(String code, String bizType, String baseId) {
        List<SsResource> resources = ssResourceService.findByCodeAndBizTypeAndOntologyBaseCode(code, bizType, baseId);
        if (resources == null || resources.isEmpty()) {
            return null;
        }
        if (resources.size() > 1) {
            throw new BaseException("本体资源编码不唯一：" + code);
        }
        return resources.get(0);
    }

    private SsResource findCurrentUserCreatedBase(String baseId) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (currentUserId == null) {
            return null;
        }
        List<SsResource> bases = ssResourceService.findByCodeAndBizTypeAndOntologyBaseCode(baseId,
            ResourceBizType.ONTOLOGY_BASE.getCode(), null);
        if (bases == null || bases.isEmpty()) {
            return null;
        }
        SsResource matched = null;
        for (SsResource base : bases) {
            if (currentUserId.equals(base.getCreateBy())) {
                if (matched != null) {
                    throw new BaseException("本体库编码不唯一：" + baseId);
                }
                matched = base;
            }
        }
        return matched;
    }

    private void grantCurrentUserOntologyChildPrivileges(SsResource baseRes, SsResource childResource) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (baseRes == null || childResource == null || childResource.getResourceId() == null || currentUserId == null) {
            return;
        }
        boolean hasBaseManagePermission = authApplicationService.hasResourceManagePermission(baseRes);
        boolean hasBaseUsePermission = authApplicationService.hasResourceUsePermission(baseRes);
        if (hasBaseManagePermission || hasBaseUsePermission) {
            authApplicationService.ensureUserDirectPrivilege(childResource, currentUserId, GrantType.FORCE_USE);
        }
        if (hasBaseManagePermission) {
            authApplicationService.ensureUserDirectPrivilege(childResource, currentUserId, GrantType.ALLOW_MANAGE);
        }
    }

    private SsResource ensureSceneResource(SsResource baseRes, String ownerType, String baseId, String sourceType,
        JSONObject scene) {
        String sceneId = firstNonBlank(scene, "sceneId", "scene_id");
        if (StringUtils.isBlank(sceneId)) {
            return null;
        }
        SsResource existing = findSingleOntologyResource(sceneId, ResourceBizType.SCENE.getCode(), baseId);
        if (existing != null) {
            return existing;
        }
        JSONObject detail = safeSceneDetail(ownerType, baseId, sceneId);
        JSONObject meta = mergeDetails(scene, detail);
        SsResource saved = insertOntologyResource(ResourceBizType.SCENE.getCode(),
            StringUtils.defaultIfBlank(firstNonBlank(meta, "sceneName", "scene_name", "name", "displayName"),
                sceneId),
            firstNonBlank(meta, "sceneDesc", "scene_desc", "description"), sceneId, baseId,
            baseRes.getResourceId(), ownerType, sourceType, meta, null, baseRes.getCreateBy());
        grantCurrentUserOntologyChildPrivileges(baseRes, saved);
        return saved;
    }

    private JSONObject findSceneSummary(String ownerType, String baseId, String sceneId) {
        JSONArray scenes = feignDataCloudService.listScenes(ownerType, baseId, null);
        if (scenes == null) {
            return null;
        }
        for (int i = 0; i < scenes.size(); i++) {
            JSONObject scene = scenes.getJSONObject(i);
            if (StringUtils.equals(sceneId, firstNonBlank(scene, "sceneId", "scene_id"))) {
                return scene;
            }
        }
        return null;
    }

    private OntologyChildContext findChildSceneContext(String ownerType, String baseId, String childCode,
        String childrenKey, String... childCodeKeys) {
        JSONArray scenes = feignDataCloudService.listScenes(ownerType, baseId, null);
        if (scenes == null) {
            return null;
        }
        for (int i = 0; i < scenes.size(); i++) {
            JSONObject scene = scenes.getJSONObject(i);
            String sceneId = firstNonBlank(scene, "sceneId", "scene_id");
            if (StringUtils.isBlank(sceneId)) {
                continue;
            }
            JSONObject detail = safeSceneDetail(ownerType, baseId, sceneId);
            if (detail == null) {
                continue;
            }
            JSONArray children = detail.getJSONArray(childrenKey);
            if (children == null) {
                continue;
            }
            for (int j = 0; j < children.size(); j++) {
                JSONObject child = children.getJSONObject(j);
                if (StringUtils.equals(childCode, firstNonBlank(child, childCodeKeys))) {
                    return new OntologyChildContext(scene, child);
                }
            }
        }
        return null;
    }

    private JSONObject safeSceneDetail(String ownerType, String baseId, String sceneId) {
        try {
            return feignDataCloudService.getSceneDetails(ownerType, baseId, sceneId);
        }
        catch (Exception e) {
            logger.warn("query datacloud scene detail failed, baseId={}, sceneId={}", baseId, sceneId, e);
            return null;
        }
    }

    private JSONObject safeObjectDetail(String objectCode) {
        try {
            return feignDataCloudService.getObjectDetailByObjectCode(objectCode);
        }
        catch (Exception e) {
            logger.warn("query datacloud object detail failed, objectCode={}", objectCode, e);
            return null;
        }
    }

    private JSONObject safeViewDetail(String viewCode) {
        try {
            return feignDataCloudService.getViewDetailByViewCode(viewCode);
        }
        catch (Exception e) {
            logger.warn("query datacloud view detail failed, viewCode={}", viewCode, e);
            return null;
        }
    }

    private JSONObject mergeDetails(JSONObject summary, JSONObject detail) {
        JSONObject merged = new JSONObject();
        if (summary != null) {
            merged.putAll(summary);
        }
        if (detail != null) {
            merged.putAll(detail);
        }
        return merged;
    }

    private String sourceTypeOfBase(SsResource baseRes) {
        SsResExtOntology ext = ssResExtOntologyMapper.selectByResourceId(baseRes.getResourceId());
        if (ext != null && StringUtils.isNotBlank(ext.getTargetContent())) {
            try {
                JSONObject target = JSON.parseObject(ext.getTargetContent());
                return StringUtils.defaultIfBlank(firstNonBlank(target, "sourceType", "source_type"), LOCAL);
            }
            catch (Exception e) {
                logger.warn("parse ontology base target content failed, resourceId={}", baseRes.getResourceId(), e);
            }
        }
        return "hosted".equalsIgnoreCase(baseRes.getHostType()) ? REMOTE : LOCAL;
    }

    private boolean isOntologyChildBizType(String bizType) {
        return ResourceBizType.SCENE.getCode().equals(bizType)
            || ResourceBizType.OBJECT.getCode().equals(bizType)
            || ResourceBizType.VIEW.getCode().equals(bizType);
    }

    private static class OntologyChildContext {

        private final JSONObject scene;

        private final JSONObject child;

        private OntologyChildContext(JSONObject scene, JSONObject child) {
            this.scene = scene;
            this.child = child;
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

        JSONObject targetContent = buildOntologyMeta(bizType, baseCode, code, name, desc, ownerType, detail);
        insertExtByBizType(saved.getResourceId(), bizType, code, baseCode, targetContent);
        initializePersonalOntologyPrivileges(saved, ownerType);
        return saved;
    }

    private JSONObject buildOntologyMeta(String bizType, String baseCode, String code, String name, String desc,
        String ownerType, JSONObject detail) {
        JSONObject targetContent = new JSONObject();
        if (detail != null) {
            targetContent.putAll(detail);
        }
        targetContent.put("ontologyBaseCode", baseCode);
        targetContent.put("resourceBizType", bizType);
        targetContent.put("resourceCode", code);
        targetContent.put("resourceName", name);
        targetContent.put("resourceDesc", desc);
        targetContent.put("ownerType", ownerType);
        if (ResourceBizType.ONTOLOGY_BASE.getCode().equals(bizType)) {
            targetContent.put("baseId", code);
        }
        else if (ResourceBizType.SCENE.getCode().equals(bizType)) {
            targetContent.put("sceneId", code);
            targetContent.put("sceneName", name);
        }
        else if (ResourceBizType.VIEW.getCode().equals(bizType)) {
            targetContent.put("viewCode", code);
            targetContent.put("viewName", name);
        }
        else if (ResourceBizType.OBJECT.getCode().equals(bizType)) {
            targetContent.put("objectCode", code);
            targetContent.put("objectName", name);
        }
        return targetContent;
    }

    private void insertExtByBizType(Long resourceId, String bizType, String code, String baseCode,
        JSONObject targetContent) {
        String targetJson = JSON.toJSONString(targetContent);
        if (ResourceBizType.ONTOLOGY_BASE.getCode().equals(bizType)) {
            replaceOntologyBaseExt(resourceId, baseCode, targetContent);
            return;
        }
        if (ResourceBizType.SCENE.getCode().equals(bizType)) {
            SsResExtScene ext = new SsResExtScene();
            ext.setResourceId(resourceId);
            ext.setSceneCode(code);
            ext.setTargetContent(targetJson);
            ssResExtSceneMapper.insert(ext);
            return;
        }
        if (ResourceBizType.VIEW.getCode().equals(bizType)) {
            SsResExtView ext = new SsResExtView();
            ext.setResourceId(resourceId);
            ext.setTargetContent(targetJson);
            ssResExtViewMapper.insert(ext);
            return;
        }
        if (ResourceBizType.OBJECT.getCode().equals(bizType)) {
            SsResExtObject ext = new SsResExtObject();
            ext.setResourceId(resourceId);
            ext.setTargetContent(targetJson);
            ssResExtObjectMapper.insert(ext);
        }
    }

    private void replaceOntologyBaseExt(Long resourceId, String baseCode, JSONObject targetContent) {
        ssResExtOntologyMapper.deleteByResourceId(resourceId);
        SsResExtOntology ext = new SsResExtOntology();
        ext.setResourceId(resourceId);
        ext.setPid(baseCode);
        ext.setTargetContent(JSON.toJSONString(targetContent));
        ssResExtOntologyMapper.insert(ext);
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
            ssResExtSceneMapper.deleteBatchIds(ids);
            ssResExtViewMapper.deleteBatchIds(ids);
            ssResExtObjectMapper.deleteBatchIds(ids);
            ssResourceMapper.deleteBatchIds(ids);
        }
        return true;
    }

    private String normalizeOwnerType(String ownerType) {
        return StringUtils.isBlank(ownerType) ? "personal" : ownerType;
    }

    private JSONArray listViewsByBaseQuietly(String baseId) {
        try {
            return feignDataCloudService.listViewsByBase(baseId, null);
        }
        catch (Exception e) {
            logger.warn("list datacloud views failed, baseId={}", baseId, e);
            return new JSONArray();
        }
    }

    private JSONArray listObjectsByBaseQuietly(String baseId) {
        try {
            return feignDataCloudService.listObjects(baseId, null);
        }
        catch (Exception e) {
            logger.warn("list datacloud objects failed, baseId={}", baseId, e);
            return new JSONArray();
        }
    }

    private String datacloudOntologyType(Set<String> bizTypes) {
        if (bizTypes == null || bizTypes.size() != 1) {
            return null;
        }
        String bizType = bizTypes.iterator().next();
        if (ResourceBizType.OBJECT.name().equalsIgnoreCase(bizType)) {
            return "object";
        }
        if (ResourceBizType.VIEW.name().equalsIgnoreCase(bizType)) {
            return "view";
        }
        return null;
    }

    private String normalizeOntologyBizType(String type, JSONObject row) {
        String rawType = StringUtils.defaultIfBlank(type, "");
        if (StringUtils.equalsAnyIgnoreCase(rawType, "view", ResourceBizType.VIEW.name())) {
            return ResourceBizType.VIEW.name();
        }
        if (StringUtils.equalsAnyIgnoreCase(rawType, "object", ResourceBizType.OBJECT.name())) {
            return ResourceBizType.OBJECT.name();
        }
        if (StringUtils.isNotBlank(firstNonBlank(row, "viewCode", "view_code", "viewName", "view_name"))) {
            return ResourceBizType.VIEW.name();
        }
        return ResourceBizType.OBJECT.name();
    }

    private JSONArray firstArray(JSONObject source, String... keys) {
        if (source == null) {
            return new JSONArray();
        }
        for (String key : keys) {
            Object value = source.get(key);
            if (value instanceof JSONArray) {
                return (JSONArray) value;
            }
        }
        return new JSONArray();
    }

    private JSONArray sceneOntologyRows(JSONObject source, String type) {
        JSONArray rows = firstArray(source, "rows", "list", "records", "items", "content", "data");
        if (!rows.isEmpty()) {
            return rows;
        }

        JSONArray mergedRows = new JSONArray();
        if (!StringUtils.equalsIgnoreCase(type, "view")) {
            appendSceneOntologyRows(mergedRows, firstArray(source, "objects"), ResourceBizType.OBJECT.name());
        }
        if (!StringUtils.equalsIgnoreCase(type, "object")) {
            appendSceneOntologyRows(mergedRows, firstArray(source, "views"), ResourceBizType.VIEW.name());
        }
        return mergedRows;
    }

    private void appendSceneOntologyRows(JSONArray target, JSONArray source, String resourceBizType) {
        if (source == null || source.isEmpty()) {
            return;
        }
        for (Object item : source) {
            JSONObject row = toJson(item);
            row.put("resourceBizType", resourceBizType);
            target.add(row);
        }
    }

    private JSONObject pagePayload(JSONObject source) {
        return pagePayload(source, 0);
    }

    private JSONObject pagePayload(JSONObject source, int depth) {
        if (source == null) {
            return new JSONObject();
        }
        if (depth > 4 || !firstArray(source, "rows", "list", "records", "items", "content", "data", "objects",
            "views").isEmpty()) {
            return source;
        }
        for (String key : new String[] { "data", "result", "resultObject", "page", "pageData" }) {
            Object value = source.get(key);
            if (value instanceof JSONObject) {
                JSONObject nested = pagePayload((JSONObject) value, depth + 1);
                if (!firstArray(nested, "rows", "list", "records", "items", "content", "data", "objects",
                    "views").isEmpty()) {
                    return nested;
                }
            }
        }
        return source;
    }

    private int firstInt(JSONObject source, int defaultValue, String... keys) {
        if (source == null) {
            return defaultValue;
        }
        for (String key : keys) {
            Integer value = source.getInteger(key);
            if (value != null) {
                return value;
            }
        }
        return defaultValue;
    }

    private void appendDatacloudResources(JSONArray rows, JSONArray resources, JSONObject base, String ownerType,
        String resourceBizType) {
        if (resources == null || resources.isEmpty()) {
            return;
        }
        for (Object item : resources) {
            JSONObject resource = toJson(item);
            JSONObject row = new JSONObject();
            String baseId = firstNonBlank(base, "baseId", "ontologyBaseCode", "baseCode", "resourceCode", "code",
                "id");
            String baseName = firstNonBlank(base, "baseName", "ontologyBaseName", "resourceName", "name",
                "displayName");
            String resourceCode = ResourceBizType.VIEW.name().equals(resourceBizType)
                ? firstNonBlank(resource, "viewCode", "resourceCode", "code", "id")
                : firstNonBlank(resource, "objectCode", "resourceCode", "code", "id");
            String resourceName = ResourceBizType.VIEW.name().equals(resourceBizType)
                ? firstNonBlank(resource, "viewName", "resourceName", "name", "displayName")
                : firstNonBlank(resource, "objectName", "resourceName", "name", "displayName");
            String resourceDesc = firstNonBlank(resource, "resourceDesc", "description", "desc", "viewDesc",
                "objectDesc");

            row.putAll(resource);
            row.put("ownerType", ownerType);
            row.put("resourceBizType", resourceBizType);
            row.put("resourceId", firstNonBlank(resource, "resourceId", "id"));
            row.put("resourceCode", resourceCode);
            row.put("resourceName", resourceName);
            row.put("resourceDesc", resourceDesc);
            row.put("resourceStatus", firstNonBlank(resource, "resourceStatus", "status"));
            row.put("permission", "apply");
            row.put("baseId", baseId);
            row.put("baseName", baseName);
            row.put("ontologyBaseCode", baseId);
            row.put("ontologyBaseName", baseName);
            row.put("catalogId", StringUtils.defaultIfBlank(firstNonBlank(resource, "catalogId"),
                firstNonBlank(base, "catalogId")));
            row.put("catalogName", StringUtils.defaultIfBlank(firstNonBlank(resource, "catalogName"),
                firstNonBlank(base, "catalogName")));
            if (ResourceBizType.VIEW.name().equals(resourceBizType)) {
                row.put("viewCode", resourceCode);
                row.put("viewName", resourceName);
            }
            else {
                row.put("objectCode", resourceCode);
                row.put("objectName", resourceName);
            }
            rows.add(row);
        }
    }

    private JSONArray filterOntologyResources(JSONArray rows, String keyword, String catalogId) {
        JSONArray filteredRows = new JSONArray();
        String keywordValue = StringUtils.trimToEmpty(keyword).toLowerCase();
        for (Object item : rows) {
            JSONObject row = toJson(item);
            if (StringUtils.isNotBlank(keywordValue) && !matchesKeyword(row, keywordValue)) {
                continue;
            }
            String rowCatalogId = row.getString("catalogId");
            if (StringUtils.isNotBlank(catalogId) && StringUtils.isNotBlank(rowCatalogId)
                && !StringUtils.equals(catalogId, rowCatalogId)) {
                continue;
            }
            filteredRows.add(row);
        }
        return filteredRows;
    }

    private boolean matchesKeyword(JSONObject row, String keyword) {
        List<String> values = new ArrayList<>();
        values.add(row.getString("resourceName"));
        values.add(row.getString("resourceCode"));
        values.add(row.getString("viewName"));
        values.add(row.getString("viewCode"));
        values.add(row.getString("objectName"));
        values.add(row.getString("objectCode"));
        return values.stream().filter(StringUtils::isNotBlank).map(String::toLowerCase)
            .anyMatch(value -> value.contains(keyword));
    }

    private Set<String> resourceBizTypes(JSONObject request) {
        Set<String> bizTypes = new HashSet<>();
        JSONArray bizTypeList = request.getJSONArray("resourceBizTypeList");
        if (bizTypeList != null) {
            for (Object item : bizTypeList) {
                if (item != null && StringUtils.isNotBlank(String.valueOf(item))) {
                    bizTypes.add(String.valueOf(item).toUpperCase());
                }
            }
        }
        String resourceBizType = request.getString("resourceBizType");
        if (StringUtils.isNotBlank(resourceBizType)) {
            bizTypes.add(resourceBizType.toUpperCase());
        }
        if (bizTypes.isEmpty()) {
            bizTypes.add(ResourceBizType.VIEW.name());
            bizTypes.add(ResourceBizType.OBJECT.name());
        }
        return bizTypes;
    }

    private Integer defaultNumber(Integer first, Integer second, Integer defaultValue) {
        if (first != null) {
            return first;
        }
        if (second != null) {
            return second;
        }
        return defaultValue;
    }

    @SuppressWarnings("unchecked")
    private JSONObject toJson(Object value) {
        if (value instanceof JSONObject) {
            return (JSONObject) value;
        }
        if (value instanceof Map) {
            JSONObject json = new JSONObject();
            json.putAll((Map<String, Object>) value);
            return json;
        }
        return JSON.parseObject(JSON.toJSONString(value));
    }

    /**
     * 校验刷新企业本体库的权限：仅平台管理/运维、业务/组织管理员或超管(adminvip)可操作，与「企业 tab 创建资源」同一角色集。
     */
    private void assertEnterpriseAdmin() {
        boolean allowed = CurrentUserHolder.isBusinessAdmin() || CurrentUserHolder.isOrganizationAdmin()
            || CurrentUserHolder.isPlatformAdminOrOperator()
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

    private String ontologyBaseCode(JSONObject row) {
        return firstNonBlankDeep(row, new String[] { "base", "ontologyBase", "baseInfo", "ontologyBaseInfo" },
            "ontologyBaseCode", "ontology_base_code", "baseId", "base_id", "baseCode", "base_code",
            "ontologyBaseId", "ontology_base_id", "pid");
    }

    private String ontologyBaseName(JSONObject row) {
        return firstNonBlankDeep(row, new String[] { "base", "ontologyBase", "baseInfo", "ontologyBaseInfo" },
            "ontologyBaseName", "ontology_base_name", "baseName", "base_name", "resourceName", "resource_name",
            "name", "displayName", "display_name");
    }

    private String sceneCode(JSONObject row, String fallback) {
        return StringUtils.defaultIfBlank(
            firstNonBlankDeep(row, new String[] { "scene", "sceneInfo", "catalog" },
                "sceneId", "scene_id", "sceneCode", "scene_code", "catalogId", "catalog_id", "catalogCode",
                "catalog_code"),
            fallback);
    }

    private String sceneName(JSONObject row) {
        return firstNonBlankDeep(row, new String[] { "scene", "sceneInfo", "catalog" },
            "sceneName", "scene_name", "catalogName", "catalog_name", "name", "displayName", "display_name");
    }

    private String datacloudUserCode(JSONObject row) {
        return firstNonBlankDeep(row, new String[] { "user", "userInfo", "owner", "creator", "createUser" },
            "userCode", "user_code", "ownerUserCode", "owner_user_code", "creatorCode", "creator_code",
            "createUserCode", "create_user_code");
    }

    private String firstNonBlankDeep(JSONObject obj, String[] nestedKeys, String... keys) {
        String direct = firstNonBlank(obj, keys);
        if (StringUtils.isNotBlank(direct)) {
            return direct;
        }
        if (obj == null || nestedKeys == null) {
            return null;
        }
        for (String nestedKey : nestedKeys) {
            Object nestedValue = obj.get(nestedKey);
            if (!(nestedValue instanceof JSONObject) && !(nestedValue instanceof Map)) {
                continue;
            }
            JSONObject nested = toJson(nestedValue);
            String value = firstNonBlank(nested, keys);
            if (StringUtils.isNotBlank(value)) {
                return value;
            }
        }
        return null;
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
