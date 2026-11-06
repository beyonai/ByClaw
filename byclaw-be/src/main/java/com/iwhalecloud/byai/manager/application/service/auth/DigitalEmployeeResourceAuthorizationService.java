package com.iwhalecloud.byai.manager.application.service.auth;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGroupApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceLifecyclePolicy;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.DigitalEmployeePublicationMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SkillGroupMapper;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

/** 企业员工配置和授权的绑定资源校验；不为关联资源增删用户授权。 */
@Service
public class DigitalEmployeeResourceAuthorizationService {
    private static final Set<String> RESOURCE_TYPES = Set.of("SKILL", "KG_DOC", "KG_DB", "KG_QA", "KG_TERM",
        "TOOL", "TOOLKIT", "MCP", "MCP_TOOL", "AGENT", "OBJECT", "VIEW");
    private static final Set<String> TOOL_TYPES = Set.of("TOOL", "TOOLKIT", "MCP", "MCP_TOOL", "AGENT");
    @Autowired
    @Lazy
    private AuthApplicationService auth;
    @Autowired
    private SsResourceMapper resources;
    @Autowired
    private SkillGroupMapper skillGroups;
    @Autowired
    private SsResourceRelDetailService relations;
    @Autowired
    private SsResExtDigEmployeeService employees;
    @Autowired
    private DigitalEmployeePublicationMapper publications;
    @Autowired
    private ByaiSystemConfigService config;

    /** 授权先锁员工，再写名单，与编辑页的资源关系变更保持相同加锁顺序。 */
    public SsResource lockForAuthorization(SsResource employee) {
        if (!isEnterpriseEmployee(employee)) return employee;
        Long tenantId = CurrentUserHolder.getEnterpriseId();
        if (tenantId == null || !Objects.equals(tenantId, employee.getComAcctId())) {
            throw new BaseException(I18nUtil.get("auth.employee.resources.invalid", employee.getResourceName()));
        }
        SsResource locked = skillGroups.selectDigitalEmployeeForUpdate(employee.getResourceId(), tenantId);
        if (locked == null) throw new BaseException(I18nUtil.get("resource.not.found"));
        // 加锁 Mapper 兼容历史跨企业查询，因此必须复核实际返回行，不能只信任查询参数。
        if (!isEnterpriseEmployee(locked) || !Objects.equals(tenantId, locked.getComAcctId())) {
            throw new BaseException(I18nUtil.get("auth.employee.resources.invalid", employee.getResourceName()));
        }
        return locked;
    }

    /** 保存和授权只校验关联资源，不读取员工使用人名单，也不生成关联资源授权。 */
    public void validateBindings(SsResource employee, List<String> relToolCodes) {
        if (!isEnterpriseEmployee(employee)) return;
        if (CurrentUserHolder.getCurrentUserId() == null || CurrentUserHolder.getEnterpriseId() == null
            || !Objects.equals(employee.getComAcctId(), CurrentUserHolder.getEnterpriseId())) {
            throw new BaseException(I18nUtil.get("auth.employee.resources.invalid", employee.getResourceName()));
        }
        SsResExtDigEmployee extension = employees.findById(employee.getResourceId());
        if (extension != null && DigitalEmployeeGroupApplicationService.GROUP_AGENT_TYPE.equals(extension.getAgentType())) {
            return;
        }
        boundResources(employee, extension, relToolCodes);
    }

    /** 审批仍校验审批人、申请人员工使用权及绑定关系，不向关联资源补授权。 */
    public void validateApprovedApplicantBindings(SsResource employee, Long applicant) {
        if (!isEnterpriseEmployee(employee)) return;
        auth.requireApplicantAuditPermission(employee, applicant);
        if (!auth.hasResourceUsePermission(employee, applicant)) {
            throw new BaseException(I18nUtil.get("auth.employee.resources.employee.use.required", employee.getResourceName()));
        }
        SsResExtDigEmployee extension = employees.findById(employee.getResourceId());
        if (extension != null && DigitalEmployeeGroupApplicationService.GROUP_AGENT_TYPE.equals(extension.getAgentType())) return;
        boundResources(employee, extension, null);
    }

    private boolean isEnterpriseEmployee(SsResource employee) {
        return employee != null && "DIG_EMPLOYEE".equals(employee.getResourceBizType())
            && OwnerType.ENTERPRISE.equals(employee.getOwnerType());
    }

    private Map<Long, SsResource> boundResources(SsResource employee, SsResExtDigEmployee extension,
        List<String> relToolCodes) {
        Map<Long, SsResource> result = new LinkedHashMap<>();
        List<SsResourceRelDetail> records = relations.findByResourceId(employee.getResourceId());
        if (records != null) {
            for (SsResourceRelDetail relation : records) {
                if (relation == null || relation.getRelResourceId() == null
                    || relation.getRelStatus() != null && relation.getRelStatus() != 1) continue;
                if (!result.containsKey(relation.getRelResourceId())) {
                    addResource(result, resources.selectById(relation.getRelResourceId()), employee,
                        String.valueOf(relation.getRelResourceId()));
                }
            }
        }
        List<String> codes = relToolCodes == null ? storedToolCodes(extension) : relToolCodes;
        if (codes.isEmpty()) return result;
        Set<String> bundledCodes = bundledToolCodes();
        for (String code : new LinkedHashSet<>(codes)) {
            if (StringUtils.isBlank(code)) continue;
            // 内置工具没有独立资源授权记录；自定义编码型工具必须唯一映射为当前企业资源。
            if ("*".equals(code) || bundledCodes.contains(code)) continue;
            List<SsResource> matches = publications.resourcesByCode(code, employee.getComAcctId());
            if (matches == null || matches.size() != 1 || matches.get(0) == null
                || !TOOL_TYPES.contains(StringUtils.defaultString(matches.get(0).getResourceBizType()))) {
                throw new BaseException(I18nUtil.get("auth.employee.resources.invalid", code));
            }
            addResource(result, matches.get(0), employee, code);
        }
        return result;
    }

    private Set<String> bundledToolCodes() {
        Set<String> result = new LinkedHashSet<>();
        String configured = config.getDcSystemConfigValueByCode("OPENCLAW_BUNDLED_TOOLS");
        if (StringUtils.isBlank(configured)) return result;
        try {
            List<JSONObject> tools = JSON.parseArray(configured, JSONObject.class);
            if (tools == null) return result;
            for (JSONObject item : tools) {
                if (item != null && !item.getBooleanValue("isWildcard")) result.add(item.getString("toolCode"));
            }
            return result;
        } catch (RuntimeException error) {
            throw new BaseException(I18nUtil.get("auth.employee.resources.configuration.invalid"));
        }
    }

    private List<String> storedToolCodes(SsResExtDigEmployee extension) {
        if (extension == null || StringUtils.isBlank(extension.getTargetContent())) return List.of();
        try {
            JSONObject content = JSON.parseObject(extension.getTargetContent());
            if (content == null || content.getJSONArray("relTools") == null) return List.of();
            return content.getJSONArray("relTools").toJavaList(String.class);
        } catch (RuntimeException error) {
            throw new BaseException(I18nUtil.get("auth.employee.resources.configuration.invalid"));
        }
    }

    private void addResource(Map<Long, SsResource> result, SsResource resource, SsResource employee, String label) {
        if (resource == null || resource.getResourceId() == null
            || !Objects.equals(employee.getComAcctId(), resource.getComAcctId())
            || !RESOURCE_TYPES.contains(StringUtils.defaultString(resource.getResourceBizType()))
            || Objects.equals(resource.getResourceStatus(), ResourceStatus.OFF_SHELF.getNum())
            || Objects.equals(resource.getResourceStatus(), ResourceStatus.DELETE.getNum())
            || !ResourceLifecyclePolicy.isRuntimeAvailable(resource)) {
            throw new BaseException(I18nUtil.get("auth.employee.resources.invalid", label));
        }
        result.putIfAbsent(resource.getResourceId(), resource);
    }

}
