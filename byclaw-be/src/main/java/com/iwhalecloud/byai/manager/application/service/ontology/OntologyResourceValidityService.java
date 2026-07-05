package com.iwhalecloud.byai.manager.application.service.ontology;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.feign.client.FeignDataCloudService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.ontology.SsResExtOntology;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.ontology.SsResExtOntologyMapper;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 本体资源有效性校验：ByClaw 资源表只维护授权/绑定索引，真实本体数据以 byclaw-datacloud 为准。
 *
 * <p>只有 datacloud 明确返回列表且找不到对应资源时，才静默将门户资源置为失效；datacloud 超时/异常导致返回 null 时，
 * 视为无法确认，不误伤资源。
 *
 * @author qin.guoquan
 * @date 2026-07-05 15:38:38
 */
@Service
public class OntologyResourceValidityService {

    private static final Logger logger = LoggerFactory.getLogger(OntologyResourceValidityService.class);

    private static final String BIZ_BASE = "ONTOLOGY_BASE";
    private static final String BIZ_SCENE = "SCENE";
    private static final String BIZ_VIEW = "VIEW";
    private static final String BIZ_OBJECT = "OBJECT";
    private static final String INVALID_DESC_MARKER = "[本体资源失效：byclaw-data已找不到该资源]";

    @Autowired
    private FeignDataCloudService feignDataCloudService;

    @Autowired
    private SsResExtOntologyMapper ssResExtOntologyMapper;

    @Autowired
    private SsResourceService ssResourceService;

    public <T extends SsResource> List<T> filterValidOntologyResources(List<T> resources) {
        if (CollectionUtils.isEmpty(resources)) {
            return resources == null ? Collections.emptyList() : resources;
        }
        ValidationContext context = new ValidationContext(resources);
        return resources.stream().filter(resource -> !isOntologyBiz(resource.getResourceBizType())
            || (isListed(resource) && validateAndInvalidate(resource, context))).collect(Collectors.toList());
    }

    public boolean validateAndInvalidate(SsResource resource) {
        if (resource == null || !isOntologyBiz(resource.getResourceBizType())) {
            return true;
        }
        if (!isListed(resource)) {
            return false;
        }
        return validateAndInvalidate(resource, new ValidationContext(List.of(resource)));
    }

    private boolean validateAndInvalidate(SsResource resource, ValidationContext context) {
        if (resource == null || !isOntologyBiz(resource.getResourceBizType())) {
            return true;
        }
        ValidationTarget target = buildTarget(resource, context);
        if (!target.checkable) {
            return true;
        }
        Boolean exists = existsInDataCloud(target, context);
        if (exists == null || exists) {
            return true;
        }
        markInvalid(resource);
        return false;
    }

    private ValidationTarget buildTarget(SsResource resource, ValidationContext context) {
        String bizType = resource.getResourceBizType();
        SsResExtOntology ext = context.extByResourceId.get(resource.getResourceId());
        JSONObject meta = parseMeta(ext == null ? null : ext.getTargetContent());
        String baseId = BIZ_BASE.equals(bizType) ? resource.getResourceCode() : ext == null ? null : ext.getPid();
        String code = resource.getResourceCode();
        if (BIZ_SCENE.equals(bizType)) {
            code = firstNonBlank(meta, "sceneId", "scene_id", "code", "sceneCode", "scene_code", "id", "name");
        }
        else if (BIZ_VIEW.equals(bizType)) {
            code = firstNonBlank(meta, "viewCode", "view_code", "code", "id", "name");
        }
        else if (BIZ_OBJECT.equals(bizType)) {
            code = firstNonBlank(meta, "objectCode", "object_code", "code", "id", "name");
        }
        code = StringUtils.defaultIfBlank(code, resource.getResourceCode());
        return new ValidationTarget(bizType, baseId, code, resource.getOwnerType(),
            StringUtils.isNotBlank(baseId) && StringUtils.isNotBlank(code));
    }

    private Boolean existsInDataCloud(ValidationTarget target, ValidationContext context) {
        if (BIZ_BASE.equals(target.bizType)) {
            Set<String> baseCodes = context.loadBaseCodes(target.ownerType);
            return baseCodes == null ? null : baseCodes.contains(target.code);
        }
        if (BIZ_SCENE.equals(target.bizType)) {
            Set<String> sceneCodes = context.loadSceneCodes(target.baseId, target.ownerType);
            return sceneCodes == null ? null : sceneCodes.contains(target.code);
        }
        if (BIZ_VIEW.equals(target.bizType)) {
            Set<String> viewCodes = context.loadViewCodes(target.baseId);
            return viewCodes == null ? null : viewCodes.contains(target.code);
        }
        if (BIZ_OBJECT.equals(target.bizType)) {
            Set<String> objectCodes = context.loadObjectCodes(target.baseId);
            return objectCodes == null ? null : objectCodes.contains(target.code);
        }
        return true;
    }

    private void markInvalid(SsResource resource) {
        if (resource == null || resource.getResourceId() == null) {
            return;
        }
        String desc = StringUtils.defaultString(resource.getResourceDesc());
        boolean alreadyMarked = desc.contains(INVALID_DESC_MARKER);
        boolean alreadyRemoved = Objects.equals(resource.getResourceStatus(), ResourceStatus.REMOVED.getNum());
        if (alreadyMarked && alreadyRemoved) {
            return;
        }
        resource.setResourceStatus(ResourceStatus.REMOVED.getNum());
        if (!alreadyMarked) {
            resource.setResourceDesc(StringUtils.isBlank(desc) ? INVALID_DESC_MARKER : desc + "\n" + INVALID_DESC_MARKER);
        }
        ssResourceService.updateResourceEntity(resource);
        logger.info("ontology resource invalidated by datacloud existence check, resourceId={}, bizType={}, code={}",
            resource.getResourceId(), resource.getResourceBizType(), resource.getResourceCode());
    }

    private boolean isOntologyBiz(String bizType) {
        return BIZ_BASE.equals(bizType) || BIZ_SCENE.equals(bizType) || BIZ_VIEW.equals(bizType)
            || BIZ_OBJECT.equals(bizType);
    }

    private boolean isListed(SsResource resource) {
        return resource != null && Objects.equals(resource.getResourceStatus(), ResourceStatus.LIST.getNum());
    }

    private JSONObject parseMeta(String content) {
        if (StringUtils.isBlank(content)) {
            return new JSONObject();
        }
        try {
            return JSON.parseObject(content);
        }
        catch (Exception e) {
            return new JSONObject();
        }
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

    private Set<String> codeSet(JSONArray rows, String... keys) {
        if (rows == null) {
            return null;
        }
        Set<String> codes = new HashSet<>();
        for (int i = 0; i < rows.size(); i++) {
            JSONObject row = rows.getJSONObject(i);
            String code = firstNonBlank(row, keys);
            if (StringUtils.isNotBlank(code)) {
                codes.add(code);
            }
        }
        return codes;
    }

    private final class ValidationContext {

        private final Map<Long, SsResExtOntology> extByResourceId = new HashMap<>();

        private final Map<String, Set<String>> baseCodesByOwnerType = new HashMap<>();

        private final Map<String, Set<String>> sceneCodesByBase = new HashMap<>();

        private final Map<String, Set<String>> viewCodesByBase = new HashMap<>();

        private final Map<String, Set<String>> objectCodesByBase = new HashMap<>();

        private ValidationContext(Collection<? extends SsResource> resources) {
            List<Long> ids = resources == null ? new ArrayList<>()
                : resources.stream().map(SsResource::getResourceId).filter(Objects::nonNull).distinct()
                    .collect(Collectors.toList());
            if (CollectionUtils.isEmpty(ids)) {
                return;
            }
            List<SsResExtOntology> exts = ssResExtOntologyMapper.selectByResourceIds(ids);
            if (exts != null) {
                exts.forEach(ext -> extByResourceId.put(ext.getResourceId(), ext));
            }
        }

        private Set<String> loadBaseCodes(String ownerType) {
            String key = "ALL";
            if (baseCodesByOwnerType.containsKey(key)) {
                return baseCodesByOwnerType.get(key);
            }
            JSONArray bases = feignDataCloudService.listOntologyBases(null, null);
            Set<String> codes = codeSet(bases, "baseId", "base_id", "resourceCode", "resource_code", "code", "id");
            baseCodesByOwnerType.put(key, codes);
            return codes;
        }

        private Set<String> loadSceneCodes(String baseId, String ownerType) {
            if (sceneCodesByBase.containsKey(baseId)) {
                return sceneCodesByBase.get(baseId);
            }
            JSONArray scenes = feignDataCloudService.listScenes(ownerType, baseId, null);
            Set<String> codes = codeSet(scenes, "sceneId", "scene_id", "sceneCode", "scene_code", "code", "id");
            sceneCodesByBase.put(baseId, codes);
            return codes;
        }

        private Set<String> loadViewCodes(String baseId) {
            if (viewCodesByBase.containsKey(baseId)) {
                return viewCodesByBase.get(baseId);
            }
            JSONArray views = feignDataCloudService.listViewsByBase(baseId, null);
            Set<String> codes = codeSet(views, "viewCode", "view_code", "code", "id");
            viewCodesByBase.put(baseId, codes);
            return codes;
        }

        private Set<String> loadObjectCodes(String baseId) {
            if (objectCodesByBase.containsKey(baseId)) {
                return objectCodesByBase.get(baseId);
            }
            JSONArray objects = feignDataCloudService.listObjects(baseId, null);
            Set<String> codes = codeSet(objects, "objectCode", "object_code", "code", "id");
            objectCodesByBase.put(baseId, codes);
            return codes;
        }
    }

    private static final class ValidationTarget {

        private final String bizType;

        private final String baseId;

        private final String code;

        private final String ownerType;

        private final boolean checkable;

        private ValidationTarget(String bizType, String baseId, String code, String ownerType, boolean checkable) {
            this.bizType = bizType;
            this.baseId = baseId;
            this.code = code;
            this.ownerType = ownerType;
            this.checkable = checkable;
        }
    }
}
