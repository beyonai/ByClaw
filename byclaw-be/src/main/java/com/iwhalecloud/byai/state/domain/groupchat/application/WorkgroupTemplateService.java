package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGroupApplicationService;
import com.iwhalecloud.byai.manager.dto.orchestrator.OrchestratorRuntimeDTO;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiWorkgroupTemplate;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiWorkgroupTemplateResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceCatalog;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiWorkgroupTemplateMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiWorkgroupTemplateResourceMapper;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceCatalogService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.WorkgroupTemplateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.WorkgroupTemplateResponse;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@Slf4j
public class WorkgroupTemplateService {
    private static final String BRAND_VERSION_CONFIG = "BYAI_BRAND_VERSION";
    private static final String ENABLED = "ENABLED";
    private static final String DISABLED = "DISABLED";

    private final ByaiWorkgroupTemplateMapper mapper;
    private final ByaiWorkgroupTemplateResourceMapper resourceMapper;
    private final SequenceService sequenceService;
    private final DigitalEmployeeGroupApplicationService groupService;
    private final SsResourceCatalogService catalogService;
    private final ByaiSystemConfigService systemConfigService;

    public WorkgroupTemplateService(ByaiWorkgroupTemplateMapper mapper,
        ByaiWorkgroupTemplateResourceMapper resourceMapper, SequenceService sequenceService,
        DigitalEmployeeGroupApplicationService groupService, SsResourceCatalogService catalogService,
        ByaiSystemConfigService systemConfigService) {
        this.mapper = mapper;
        this.resourceMapper = resourceMapper;
        this.sequenceService = sequenceService;
        this.groupService = groupService;
        this.catalogService = catalogService;
        this.systemConfigService = systemConfigService;
    }

    public boolean canManage() {
        String edition = systemConfigService.getDcSystemConfigValueByCode(BRAND_VERSION_CONFIG);
        return CurrentUserHolder.isAdminVip() && !"commercial".equalsIgnoreCase(edition);
    }

    public List<WorkgroupTemplateResponse> list(String keyword, Long catalogId, boolean includeDisabled) {
        if (includeDisabled) {
            guard();
        }
        LambdaQueryWrapper<ByaiWorkgroupTemplate> query = new LambdaQueryWrapper<>();
        if (!includeDisabled) {
            query.eq(ByaiWorkgroupTemplate::getStatus, ENABLED);
        }
        if (catalogId != null) {
            query.eq(ByaiWorkgroupTemplate::getCatalogId, catalogId);
        }
        if (StringUtils.isNotBlank(keyword)) {
            query.and(q -> q.like(ByaiWorkgroupTemplate::getTemplateName, keyword.trim())
                .or().like(ByaiWorkgroupTemplate::getSummary, keyword.trim()));
        }
        query.orderByAsc(ByaiWorkgroupTemplate::getSortOrder).orderByDesc(ByaiWorkgroupTemplate::getUpdateTime);
        List<WorkgroupTemplateResponse> result = new ArrayList<>();
        for (ByaiWorkgroupTemplate value : mapper.selectList(query)) {
            try {
                result.add(resolve(value));
            }
            catch (RuntimeException exception) {
                log.warn("Workgroup template {} references an unavailable digital employee resource",
                    value.getTemplateId(), exception);
                if (includeDisabled) {
                    WorkgroupTemplateResponse unavailable = new WorkgroupTemplateResponse();
                    unavailable.setTemplate(value);
                    unavailable.setAvailable(false);
                    unavailable.setUnavailableReason("关联的数字员工资源当前不可用");
                    unavailable.setEmployees(List.of());
                    result.add(unavailable);
                }
            }
        }
        return result;
    }

    public List<WorkgroupTemplateResponse> listForManagement() {
        guard();
        return list(null, null, false);
    }

    public WorkgroupTemplateResponse requireEnabled(Long id, Long expectedVersion) {
        ByaiWorkgroupTemplate value = mapper.selectById(id);
        if (value == null || !ENABLED.equals(value.getStatus())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "工作组模板不存在或已停用");
        }
        if (expectedVersion != null && !expectedVersion.equals(value.getVersion())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "工作组模板已更新，请重新选择");
        }
        return resolve(value);
    }

    @Transactional
    public WorkgroupTemplateResponse save(Long id, WorkgroupTemplateRequest request) {
        guard();
        ByaiWorkgroupTemplate value = id == null ? new ByaiWorkgroupTemplate() : mapper.selectById(id);
        if (id != null && value == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "工作组模板不存在");
        }
        if (id != null && request.getExpectedVersion() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "更新模板时必须提交版本号");
        }
        if (id != null && !request.getExpectedVersion().equals(value.getVersion())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "工作组模板已被修改");
        }
        SsResourceCatalog catalog = requireCatalog(request.getCatalogId());
        List<Long> resourceIds = request.getResourceIds().stream().distinct().toList();
        resourceIds.forEach(this::resolveResource);
        Date now = new Date();
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (id == null) {
            value.setTemplateId(sequenceService.nextVal());
            value.setCreateBy(userId);
            value.setCreateTime(now);
            value.setVersion(1L);
        }
        else {
            value.setVersion(value.getVersion() + 1);
        }
        value.setTemplateName(request.getTemplateName().trim());
        value.setCatalogId(catalog.getCatalogId());
        value.setSummary(request.getSummary().trim());
        value.setDefaultGroupName(request.getDefaultGroupName().trim());
        value.setDefaultGoal(request.getDefaultGoal().trim());
        value.setIcon(StringUtils.trimToNull(request.getIcon()));
        value.setSortOrder(request.getSortOrder() == null ? 0 : request.getSortOrder());
        value.setStatus(ENABLED);
        value.setUpdateBy(userId);
        value.setUpdateTime(now);
        if (id == null) {
            mapper.insert(value);
        }
        else {
            mapper.updateById(value);
        }
        replaceResources(value.getTemplateId(), resourceIds);
        return resolve(value);
    }

    @Transactional
    public void delete(Long id, Long expectedVersion) {
        guard();
        ByaiWorkgroupTemplate value = mapper.selectById(id);
        if (value == null || DISABLED.equals(value.getStatus())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "工作组模板不存在");
        }
        if (expectedVersion == null || !expectedVersion.equals(value.getVersion())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "工作组模板已被修改");
        }
        value.setStatus(DISABLED);
        value.setVersion(value.getVersion() + 1);
        value.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        value.setUpdateTime(new Date());
        mapper.updateById(value);
    }

    public List<Long> resolveResourceIds(Long templateId, Long version) {
        return requireEnabled(templateId, version).getResources().stream()
            .map(resource -> Long.valueOf(resource.getResourceId()))
            .toList();
    }

    private WorkgroupTemplateResponse resolve(ByaiWorkgroupTemplate value) {
        WorkgroupTemplateResponse response = new WorkgroupTemplateResponse();
        response.setTemplate(value);
        SsResourceCatalog catalog = requireCatalog(value.getCatalogId());
        response.setCatalogName(catalog.getCatalogName());
        List<WorkgroupTemplateResponse.Resource> resources = new ArrayList<>();
        Map<String, OrchestratorRuntimeDTO.Agent> employees = new LinkedHashMap<>();
        for (ByaiWorkgroupTemplateResource relation : listResources(value.getTemplateId())) {
            OrchestratorRuntimeDTO runtime = resolveResource(relation.getResourceId());
            WorkgroupTemplateResponse.Resource resource = new WorkgroupTemplateResponse.Resource();
            resource.setResourceId(String.valueOf(relation.getResourceId()));
            resource.setResourceName(runtime.getOrchestrator().getName());
            resource.setResourceType("EXPERT_TEAM".equals(runtime.getOrchestrator().getKind())
                ? "DIGITAL_EMPLOYEE_GROUP" : "DIGITAL_EMPLOYEE");
            resource.setAvatar(runtime.getOrchestrator().getAvatar());
            resource.setResourceVersion(runtime.getConfigVersion());
            resource.setEmployees(runtime.getAgents());
            resources.add(resource);
            runtime.getAgents().forEach(agent -> employees.putIfAbsent(agent.getId(), agent));
        }
        if (resources.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "工作组模板未配置数字员工资源");
        }
        response.setResources(resources);
        response.setEmployees(new ArrayList<>(employees.values()));
        return response;
    }

    private SsResourceCatalog requireCatalog(Long catalogId) {
        SsResourceCatalog catalog = catalogService.findById(catalogId);
        if (catalog == null || !Integer.valueOf(6).equals(catalog.getCatalogType())
            || !Objects.equals(CurrentUserHolder.getEnterpriseId(), catalog.getComAcctId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "资产目录不存在或不可用");
        }
        return catalog;
    }

    private List<ByaiWorkgroupTemplateResource> listResources(Long templateId) {
        return resourceMapper.selectList(new LambdaQueryWrapper<ByaiWorkgroupTemplateResource>()
            .eq(ByaiWorkgroupTemplateResource::getTemplateId, templateId)
            .orderByAsc(ByaiWorkgroupTemplateResource::getSortOrder));
    }

    private void replaceResources(Long templateId, List<Long> resourceIds) {
        resourceMapper.delete(new LambdaQueryWrapper<ByaiWorkgroupTemplateResource>()
            .eq(ByaiWorkgroupTemplateResource::getTemplateId, templateId));
        for (int index = 0; index < resourceIds.size(); index++) {
            ByaiWorkgroupTemplateResource relation = new ByaiWorkgroupTemplateResource();
            relation.setTemplateId(templateId);
            relation.setResourceId(resourceIds.get(index));
            relation.setSortOrder(index + 1);
            resourceMapper.insert(relation);
        }
    }

    private OrchestratorRuntimeDTO resolveResource(Long id) {
        return groupService.resolveTemplateResource(id);
    }

    private void guard() {
        if (!canManage()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "仅开源版 adminvip 可管理工作组模板");
        }
    }
}
