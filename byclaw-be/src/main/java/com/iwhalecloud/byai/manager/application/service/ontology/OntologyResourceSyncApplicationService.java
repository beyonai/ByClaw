package com.iwhalecloud.byai.manager.application.service.ontology;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.openapi.OntologyResourceDeleteRequest;
import com.iwhalecloud.byai.manager.dto.openapi.OntologyResourceSyncRequest;
import com.iwhalecloud.byai.manager.dto.openapi.OntologyResourceSyncResultDto;
import com.iwhalecloud.byai.manager.entity.ontology.SsResExtOntology;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtObject;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtScene;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtView;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.ontology.SsResExtOntologyMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtObjectMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtSceneMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtViewMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * datacloud 主动同步本体资源索引到 ByClaw 资源表。
 *
 * <p>这里不再回调 datacloud 二次校验存在性，完全以 datacloud 推送内容更新本地资源索引。
 *
 * @author qin.guoquan
 * @date 2026-07-06 16:05:00
 */
@Service
public class OntologyResourceSyncApplicationService {

    private static final String RESOURCE_TYPE_ATOM = "ATOM";
    private static final String SOURCE_TYPE_REMOTE = "REMOTE";
    private static final Long ROOT_PARENT_ID = -1L;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private SsResExtOntologyMapper ssResExtOntologyMapper;

    @Autowired
    private SsResExtSceneMapper ssResExtSceneMapper;

    @Autowired
    private SsResExtViewMapper ssResExtViewMapper;

    @Autowired
    private SsResExtObjectMapper ssResExtObjectMapper;

    @Autowired
    private SsResourceRelDetailService ssResourceRelDetailService;

    @Autowired
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;

    @Transactional(rollbackFor = Exception.class)
    public OntologyResourceSyncResultDto createOntologyResource(OntologyResourceSyncRequest request) {
        return upsertOntologyResource(request);
    }

    @Transactional(rollbackFor = Exception.class)
    public OntologyResourceSyncResultDto updateOntologyResource(OntologyResourceSyncRequest request) {
        return upsertOntologyResource(request);
    }

    @Transactional(rollbackFor = Exception.class)
    public OntologyResourceSyncResultDto upsertOntologyResource(OntologyResourceSyncRequest request) {
        validateUpsertRequest(request);
        String bizType = normalizeBizType(request.getResourceBizType());
        String systemCode = StringUtils.trim(request.getSystemCode());
        String resourceCode = StringUtils.trim(request.getResourceCode());
        String baseCode = normalizeBaseCode(bizType, resourceCode, request.getOntologyBaseCode());
        SsResource parent = resolveParentResource(request, bizType, baseCode);
        SsResource existing = resolveUniqueResource(systemCode, bizType, resourceCode, baseCode, parent);
        JSONObject targetContent = buildTargetContent(request, bizType, resourceCode, baseCode, parent);

        if (existing == null) {
            SsResource created = buildResource(request, bizType, resourceCode, baseCode, parent);
            ssResourceService.saveResource(created);
            replaceExt(created.getResourceId(), bizType, resourceCode, baseCode, request.getSourceContent(),
                targetContent);
            return result("created", created, baseCode);
        }

        updateResource(existing, request, bizType, resourceCode, baseCode, parent);
        ssResourceService.updateResourceEntity(existing);
        replaceExt(existing.getResourceId(), bizType, resourceCode, baseCode, request.getSourceContent(),
            targetContent);
        return result("updated", existing, baseCode);
    }

    @Transactional(rollbackFor = Exception.class)
    public OntologyResourceSyncResultDto deleteOntologyResource(OntologyResourceDeleteRequest request) {
        validateDeleteRequest(request);
        String bizType = normalizeBizType(request.getResourceBizType());
        String systemCode = StringUtils.trim(request.getSystemCode());
        String resourceCode = StringUtils.trim(request.getResourceCode());
        String baseCode = normalizeBaseCode(bizType, resourceCode, request.getOntologyBaseCode());
        List<SsResource> targets = resolveDeleteTargets(request, systemCode, bizType, resourceCode, baseCode);
        if (CollectionUtils.isEmpty(targets)) {
            OntologyResourceSyncResultDto result = new OntologyResourceSyncResultDto();
            result.setAction("not_found");
            result.setResourceBizType(bizType);
            result.setResourceCode(resourceCode);
            result.setOntologyBaseCode(baseCode);
            return result;
        }

        List<Long> deleteIds = targets.stream().map(SsResource::getResourceId).filter(Objects::nonNull).distinct()
            .collect(Collectors.toList());
        List<Long> impactedEmployeeIds = findImpactedEmployeeIds(deleteIds);
        for (Long employeeId : impactedEmployeeIds) {
            List<Long> targetRelIds = ssResourceRelDetailService.findByResourceId(employeeId).stream()
                .map(SsResourceRelDetail::getRelResourceId).filter(Objects::nonNull)
                .filter(id -> !deleteIds.contains(id)).distinct().collect(Collectors.toList());
            digitalEmployeeApplicationService.syncRelResourcesByTargetIds(employeeId, targetRelIds);
        }

        for (SsResource target : targets) {
            deleteExt(target);
            ssResourceRelDetailService.removeAllByResourceIdOrRelResourceId(target.getResourceId());
            ssResourceMapper.deleteById(target.getResourceId());
        }

        OntologyResourceSyncResultDto result = new OntologyResourceSyncResultDto();
        result.setAction("deleted");
        result.setResourceIds(deleteIds);
        result.setResourceId(deleteIds.size() == 1 ? deleteIds.get(0) : null);
        result.setResourceBizType(bizType);
        result.setResourceCode(resourceCode);
        result.setOntologyBaseCode(baseCode);
        return result;
    }

    private void validateUpsertRequest(OntologyResourceSyncRequest request) {
        if (request == null || StringUtils.isBlank(request.getResourceBizType())
            || StringUtils.isBlank(request.getSystemCode())
            || StringUtils.isBlank(request.getResourceCode())
            || StringUtils.isBlank(request.getResourceName())) {
            throw new BaseException("本体资源同步参数不完整：resourceBizType / systemCode / resourceCode / resourceName 不能为空");
        }
        normalizeBizType(request.getResourceBizType());
    }

    private void validateDeleteRequest(OntologyResourceDeleteRequest request) {
        if (request == null || StringUtils.isBlank(request.getResourceBizType())
            || StringUtils.isBlank(request.getSystemCode())
            || StringUtils.isBlank(request.getResourceCode())) {
            throw new BaseException("本体资源删除同步参数不完整：resourceBizType / systemCode / resourceCode 不能为空");
        }
        normalizeBizType(request.getResourceBizType());
    }

    private String normalizeBizType(String bizType) {
        String normalized = StringUtils.upperCase(StringUtils.trim(bizType));
        if (ResourceBizType.ONTOLOGY_BASE.getCode().equals(normalized)
            || ResourceBizType.SCENE.getCode().equals(normalized)
            || ResourceBizType.VIEW.getCode().equals(normalized)
            || ResourceBizType.OBJECT.getCode().equals(normalized)) {
            return normalized;
        }
        throw new BaseException("不支持的本体资源类型：" + bizType);
    }

    private String normalizeBaseCode(String bizType, String resourceCode, String ontologyBaseCode) {
        if (ResourceBizType.ONTOLOGY_BASE.getCode().equals(bizType)) {
            return resourceCode;
        }
        if (StringUtils.isBlank(ontologyBaseCode)) {
            throw new BaseException("场景、视图、对象同步时 ontologyBaseCode 不能为空");
        }
        return StringUtils.trim(ontologyBaseCode);
    }

    private SsResource resolveParentResource(OntologyResourceSyncRequest request, String bizType, String baseCode) {
        if (ResourceBizType.ONTOLOGY_BASE.getCode().equals(bizType)) {
            return null;
        }
        String parentBizType = StringUtils.defaultIfBlank(request.getParentResourceBizType(),
            ResourceBizType.ONTOLOGY_BASE.getCode());
        String parentCode = StringUtils.defaultIfBlank(request.getParentResourceCode(), baseCode);
        SsResource parent = resolveUniqueResource(request.getSystemCode(), normalizeBizType(parentBizType), parentCode,
            baseCode, null);
        if (parent == null) {
            throw new BaseException("本体父资源不存在，请先同步父资源：" + parentBizType + "/" + parentCode);
        }
        return parent;
    }

    private SsResource buildResource(OntologyResourceSyncRequest request, String bizType, String resourceCode,
        String baseCode, SsResource parent) {
        SsResource resource = new SsResource();
        resource.setResourceBizType(bizType);
        resource.setResourceCode(resourceCode);
        resource.setResourceName(resolveName(request, bizType, resourceCode));
        resource.setResourceDesc(resolveDesc(request));
        resource.setResourceType(RESOURCE_TYPE_ATOM);
        resource.setSystemCode(StringUtils.trim(request.getSystemCode()));
        resource.setOwnerType(resolveOwnerType(request, parent));
        resource.setResourceStatus(ResourceStatus.LIST.getNum());
        resource.setResourceVersionId("1.0");
        resource.setParentResourceId(parent == null ? ROOT_PARENT_ID : parent.getResourceId());
        resource.setHostType("local");
        resource.setImplType("ASK_AGENT");
        resource.setWorkerAgentType("BYCLAW_DATA");
        resource.setCatalogId(request.getCatalogId());
        return resource;
    }

    private void updateResource(SsResource resource, OntologyResourceSyncRequest request, String bizType,
        String resourceCode, String baseCode, SsResource parent) {
        resource.setResourceBizType(bizType);
        resource.setResourceCode(resourceCode);
        resource.setResourceName(resolveName(request, bizType, resourceCode));
        resource.setResourceDesc(resolveDesc(request));
        resource.setOwnerType(resolveOwnerType(request, parent));
        resource.setResourceStatus(ResourceStatus.LIST.getNum());
        resource.setParentResourceId(parent == null ? ROOT_PARENT_ID : parent.getResourceId());
        resource.setSystemCode(StringUtils.trim(request.getSystemCode()));
        resource.setResourceType(RESOURCE_TYPE_ATOM);
        resource.setHostType("local");
        resource.setImplType("ASK_AGENT");
        resource.setWorkerAgentType("BYCLAW_DATA");
        if (request.getCatalogId() != null) {
            resource.setCatalogId(request.getCatalogId());
        }
    }

    private String resolveName(OntologyResourceSyncRequest request, String bizType, String resourceCode) {
        return request.getResourceName();
    }

    private String resolveDesc(OntologyResourceSyncRequest request) {
        if (StringUtils.isNotBlank(request.getResourceDesc())) {
            return request.getResourceDesc();
        }
        JSONObject target = request.getExtraContent();
        return target == null ? null
            : firstNonBlank(target, "resourceDesc", "description", "desc", "sceneDesc", "viewDesc", "objectDesc");
    }

    private String resolveOwnerType(OntologyResourceSyncRequest request, SsResource parent) {
        if (StringUtils.isNotBlank(request.getOwnerType())) {
            return StringUtils.lowerCase(StringUtils.trim(request.getOwnerType()));
        }
        if (parent != null && StringUtils.isNotBlank(parent.getOwnerType())) {
            return parent.getOwnerType();
        }
        return "personal";
    }

    private SsResource resolveUniqueResource(String systemCode, String bizType, String resourceCode, String baseCode,
        SsResource parent) {
        List<SsResource> resources = ssResourceService.findByCodeAndBizTypeAndOntologyBaseCode(resourceCode, bizType,
            baseCode);
        resources = resources.stream()
            .filter(resource -> StringUtils.equals(resource.getSystemCode(), StringUtils.trim(systemCode)))
            .collect(Collectors.toList());
        if (parent != null) {
            resources = resources.stream()
                .filter(resource -> Objects.equals(resource.getParentResourceId(), parent.getResourceId()))
                .collect(Collectors.toList());
        }
        if (CollectionUtils.isEmpty(resources)) {
            return null;
        }
        if (resources.size() > 1) {
            throw new BaseException("本体资源匹配到多条，请传入 parentResourceBizType / parentResourceCode 消歧");
        }
        return resources.get(0);
    }

    private List<SsResource> resolveDeleteTargets(OntologyResourceDeleteRequest request, String systemCode,
        String bizType, String resourceCode, String baseCode) {
        if (ResourceBizType.ONTOLOGY_BASE.getCode().equals(bizType)) {
            List<Long> ids = ssResourceService.findOntologyResourceIdsByBaseCode(baseCode);
            if (CollectionUtils.isEmpty(ids)) {
                return Collections.emptyList();
            }
            return ssResourceMapper.selectBatchIds(ids).stream()
                .filter(resource -> StringUtils.equals(resource.getSystemCode(), systemCode))
                .collect(Collectors.toList());
        }
        SsResource parent = null;
        if (StringUtils.isNotBlank(request.getParentResourceBizType())
            || StringUtils.isNotBlank(request.getParentResourceCode())) {
            String parentBizType = StringUtils.defaultIfBlank(request.getParentResourceBizType(),
                ResourceBizType.ONTOLOGY_BASE.getCode());
            String parentCode = StringUtils.defaultIfBlank(request.getParentResourceCode(), baseCode);
            parent = resolveUniqueResource(systemCode, normalizeBizType(parentBizType), parentCode, baseCode, null);
            if (parent == null) {
                return Collections.emptyList();
            }
        }
        SsResource resource = resolveUniqueResource(systemCode, bizType, resourceCode, baseCode, parent);
        return resource == null ? Collections.emptyList() : List.of(resource);
    }

    private JSONObject buildTargetContent(OntologyResourceSyncRequest request, String bizType, String resourceCode,
        String baseCode, SsResource parent) {
        JSONObject target = new JSONObject();
        if (request.getExtraContent() != null) {
            target.putAll(request.getExtraContent());
        }
        target.put("ontologyBaseCode", baseCode);
        target.put("systemCode", StringUtils.trim(request.getSystemCode()));
        target.put("resourceBizType", bizType);
        target.put("resourceCode", resourceCode);
        target.put("resourceName", resolveName(request, bizType, resourceCode));
        target.put("resourceDesc", resolveDesc(request));
        target.put("ownerType", resolveOwnerType(request, parent));
        target.put("sourceType", StringUtils.defaultIfBlank(request.getSourceType(), SOURCE_TYPE_REMOTE));
        if (parent != null) {
            target.put("parentResourceId", parent.getResourceId());
            target.put("parentResourceBizType", parent.getResourceBizType());
            target.put("parentResourceCode", parent.getResourceCode());
        }
        if (ResourceBizType.ONTOLOGY_BASE.getCode().equals(bizType)) {
            target.put("baseId", resourceCode);
        }
        else if (ResourceBizType.SCENE.getCode().equals(bizType)) {
            target.put("sceneId", resourceCode);
            target.put("sceneName", resolveName(request, bizType, resourceCode));
        }
        else if (ResourceBizType.VIEW.getCode().equals(bizType)) {
            target.put("viewCode", resourceCode);
            target.put("viewName", resolveName(request, bizType, resourceCode));
        }
        else if (ResourceBizType.OBJECT.getCode().equals(bizType)) {
            target.put("objectCode", resourceCode);
            target.put("objectName", resolveName(request, bizType, resourceCode));
        }
        return target;
    }

    private void replaceExt(Long resourceId, String bizType, String resourceCode, String baseCode, String sourceContent,
        JSONObject targetContent) {
        deleteExtByBizType(resourceId, bizType);
        String targetJson = JSON.toJSONString(targetContent);
        if (ResourceBizType.ONTOLOGY_BASE.getCode().equals(bizType)) {
            SsResExtOntology ext = new SsResExtOntology();
            ext.setResourceId(resourceId);
            ext.setPid(baseCode);
            ext.setSourceContent(sourceContent);
            ext.setTargetContent(targetJson);
            ssResExtOntologyMapper.insert(ext);
            return;
        }
        if (ResourceBizType.SCENE.getCode().equals(bizType)) {
            SsResExtScene ext = new SsResExtScene();
            ext.setResourceId(resourceId);
            ext.setSceneCode(resourceCode);
            ext.setSourceContent(sourceContent);
            ext.setTargetContent(targetJson);
            ssResExtSceneMapper.insert(ext);
            return;
        }
        if (ResourceBizType.VIEW.getCode().equals(bizType)) {
            SsResExtView ext = new SsResExtView();
            ext.setResourceId(resourceId);
            ext.setSourceContent(sourceContent);
            ext.setTargetContent(targetJson);
            ssResExtViewMapper.insert(ext);
            return;
        }
        SsResExtObject ext = new SsResExtObject();
        ext.setResourceId(resourceId);
        ext.setSourceContent(sourceContent);
        ext.setTargetContent(targetJson);
        ssResExtObjectMapper.insert(ext);
    }

    private void deleteExt(SsResource resource) {
        if (resource == null || resource.getResourceId() == null) {
            return;
        }
        deleteExtByBizType(resource.getResourceId(), resource.getResourceBizType());
    }

    private void deleteExtByBizType(Long resourceId, String bizType) {
        if (ResourceBizType.ONTOLOGY_BASE.getCode().equals(bizType)) {
            ssResExtOntologyMapper.deleteByResourceId(resourceId);
        }
        else if (ResourceBizType.SCENE.getCode().equals(bizType)) {
            ssResExtSceneMapper.deleteById(resourceId);
        }
        else if (ResourceBizType.VIEW.getCode().equals(bizType)) {
            ssResExtViewMapper.deleteById(resourceId);
        }
        else if (ResourceBizType.OBJECT.getCode().equals(bizType)) {
            ssResExtObjectMapper.deleteById(resourceId);
        }
    }

    private List<Long> findImpactedEmployeeIds(List<Long> deleteIds) {
        if (CollectionUtils.isEmpty(deleteIds)) {
            return Collections.emptyList();
        }
        LambdaQueryWrapper<SsResourceRelDetail> wrapper = new LambdaQueryWrapper<>();
        wrapper.in(SsResourceRelDetail::getRelResourceId, deleteIds);
        return ssResourceRelDetailService.list(wrapper).stream().map(SsResourceRelDetail::getResourceId)
            .filter(Objects::nonNull).distinct().collect(Collectors.toList());
    }

    private OntologyResourceSyncResultDto result(String action, SsResource resource, String baseCode) {
        OntologyResourceSyncResultDto result = new OntologyResourceSyncResultDto();
        result.setAction(action);
        result.setResourceId(resource.getResourceId());
        result.setResourceIds(List.of(resource.getResourceId()));
        result.setResourceBizType(resource.getResourceBizType());
        result.setResourceCode(resource.getResourceCode());
        result.setOntologyBaseCode(baseCode);
        return result;
    }

    private String firstNonBlank(JSONObject json, String... keys) {
        if (json == null) {
            return null;
        }
        for (String key : keys) {
            String value = json.getString(key);
            if (StringUtils.isNotBlank(value)) {
                return value;
            }
        }
        return null;
    }
}
