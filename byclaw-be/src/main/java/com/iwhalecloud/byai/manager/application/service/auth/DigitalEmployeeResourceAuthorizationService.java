package com.iwhalecloud.byai.manager.application.service.auth;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.constants.auth.GrantType;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGroupApplicationService;
import com.iwhalecloud.byai.manager.domain.auth.enums.Color;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantToObjType;
import com.iwhalecloud.byai.manager.domain.auth.enums.OperType;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceLifecyclePolicy;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.DigitalEmployeePublicationMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SkillGroupMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.ArrayList;
import java.util.Date;
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
import org.springframework.transaction.annotation.Transactional;

/** 企业员工配置和人员授权共用的资源使用权限补齐；不撤销资源上的任何既有授权。 */
@Service
public class DigitalEmployeeResourceAuthorizationService {

    private static final Set<String> RESOURCE_TYPES = Set.of("SKILL", "KG_DOC", "KG_DB", "KG_QA", "KG_TERM",
        "TOOL", "TOOLKIT", "MCP", "MCP_TOOL", "AGENT", "OBJECT", "VIEW");
    private static final Set<String> TOOL_TYPES = Set.of("TOOL", "TOOLKIT", "MCP", "MCP_TOOL", "AGENT");
    private static final Set<String> USE_TYPES = Set.of(GrantType.ALLOW_MANAGE, GrantType.AVAILABLE_USE,
        GrantType.FORCE_USE);

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
    private PrivilegeGrantService grants;
    @Autowired
    private UsersMapper users;
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

    /** relToolCodes 非空时使用本次配置；为 null 时读取已生效的运行配置镜像。 */
    @Transactional(rollbackFor = Exception.class)
    public void synchronize(SsResource employee, List<String> relToolCodes) {
        if (!isEnterpriseEmployee(employee)) return;
        if (CurrentUserHolder.getCurrentUserId() == null || CurrentUserHolder.getEnterpriseId() == null
            || !Objects.equals(employee.getComAcctId(), CurrentUserHolder.getEnterpriseId())) {
            throw new BaseException(I18nUtil.get("auth.employee.resources.invalid", employee.getResourceName()));
        }
        SsResExtDigEmployee extension = employees.findById(employee.getResourceId());
        // 员工组继续使用已有组员/关联资源同步契约，避免把组授权改成个人授权快照。
        if (extension != null && DigitalEmployeeGroupApplicationService.GROUP_AGENT_TYPE.equals(extension.getAgentType())) {
            return;
        }
        Map<Long, SsResource> boundResources = boundResources(employee, extension, relToolCodes);
        if (boundResources.isEmpty()) return;
        Set<Long> userIds = effectiveUsers(employee);
        Map<SsResource, List<Long>> missing = new LinkedHashMap<>();
        for (SsResource resource : boundResources.values()) {
            if (Boolean.TRUE.equals(resource.getUseAuthControlled()) || Boolean.TRUE.equals(resource.getViewAuthControlled())) continue;
            for (Long userId : userIds) {
                if (auth.hasResourceUsePermission(resource, userId)) continue;
                // 员工管理权限不能替代资源授权维护权限；黑名单也不能被自动授权覆盖。
                auth.validateDigitalEmployeeResourceUseGrant(resource, userId);
                missing.computeIfAbsent(resource, ignored -> new ArrayList<>()).add(userId);
            }
        }
        // 整批先校验再追加，任一资源失败时由员工保存/人员授权的外层事务回滚。
        missing.forEach(auth::appendDigitalEmployeeResourceUsePrivileges);
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

    private Set<Long> effectiveUsers(SsResource employee) {
        Set<Long> candidates = new LinkedHashSet<>();
        if (employee.getCreateBy() != null) candidates.add(employee.getCreateBy());
        Date now = new Date();
        List<PrivilegeGrant> records = grants.listActiveRedGrantsForGrantObject(employee.getResourceId(), "DIG_EMPLOYEE");
        if (records != null) {
            for (PrivilegeGrant grant : records) {
                if (grant == null || !USE_TYPES.contains(StringUtils.defaultString(grant.getGrantType()))
                    || !isEffective(grant, now)) continue;
                Long targetId = grant.getGrantToObjId();
                if (targetId == null) continue;
                switch (StringUtils.upperCase(StringUtils.trimToEmpty(grant.getGrantToObjType()), java.util.Locale.ROOT)) {
                    case GrantToObjType.USER -> candidates.add(targetId);
                    case GrantToObjType.ORG -> candidates.addAll(users.findUserIdsByOrgIdListIncludingChildren(List.of(targetId)));
                    case GrantToObjType.POST -> candidates.addAll(users.findUserIdsByPostId(targetId));
                    case GrantToObjType.STATION -> candidates.addAll(users.findUserIdsByStationIdListIncludingChildren(List.of(targetId)));
                    default -> { }
                }
            }
        }
        // 展开继承范围后再按真实权限排除黑名单用户，不把员工排除名单复制到共享资源。
        candidates.removeIf(id -> id == null || !auth.hasResourceUsePermission(employee, id));
        return candidates;
    }

    private boolean isEffective(PrivilegeGrant grant, Date now) {
        return "A".equalsIgnoreCase(grant.getStatusCd()) && Color.RED.equalsIgnoreCase(grant.getGrantToType())
            && OperType.READ.equals(grant.getOperType())
            && (grant.getEffDate() == null || !grant.getEffDate().after(now))
            && (grant.getExpDate() == null || grant.getExpDate().after(now));
    }
}
