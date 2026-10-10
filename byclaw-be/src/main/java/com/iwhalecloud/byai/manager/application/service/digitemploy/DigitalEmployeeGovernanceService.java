package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.resource.DigitalEmployType;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.resource.DigitalEmployeePublicationMapper;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.Objects;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Service;

/** Rules specific to employee publication; maintenance follows the resource permission checks.
 * @author qin.guoquan
 * @date 2026-09-27 22:38:38
 * */
@Service
public class DigitalEmployeeGovernanceService {
    private final UserService users;
    private final ByaiSystemConfigService config;
    private final DigitalEmployeePublicationMapper publications;
    private final SsResExtDigEmployeeService employeeExtensions;

    public DigitalEmployeeGovernanceService(UserService users, ByaiSystemConfigService config,
        DigitalEmployeePublicationMapper publications, SsResExtDigEmployeeService employeeExtensions) {
        this.users = users;
        this.config = config;
        this.publications = publications;
        this.employeeExtensions = employeeExtensions;
    }

    public boolean publicationEnabled() {
        return true; // 开源与商业版本共用发布流程，角色、租户和资源权限仍分别校验。
    }

    public static boolean isAdministrator() {
        return CurrentUserHolder.isAdminVip() || CurrentUserHolder.isPlatformManager();
    }

    public static boolean isEmployee(SsResource resource) {
        return resource != null && "DIG_EMPLOYEE".equals(resource.getResourceBizType());
    }

    public static boolean isOfficialCopy(SsResource resource) {
        return isEmployee(resource) && "enterprise".equals(resource.getOwnerType())
            && resource.getPublicationSourceId() != null
            && !Objects.equals(resource.getResourceId(), resource.getPublicationSourceId());
    }

    public static boolean isPublicationSkill(SsResource resource) {
        return resource != null && "SKILL".equals(resource.getResourceBizType()) && resource.getPublicationRequestId() != null;
    }

    public boolean canPublish(SsResource resource) {
        return isPublishSource(resource) && isPublishableEmployeeType(employeeExtensions.findById(resource.getResourceId()));
    }

    /** 本页一次查询扩展信息，避免权限列表按员工逐条查类型。缺少配置的资源不开放发布入口。 */
    public Map<Long, Boolean> canPublishBatch(Collection<SsResource> resources) {
        var sourceIds = resources.stream().filter(this::isPublishSource).map(SsResource::getResourceId).distinct().toList();
        if (sourceIds.isEmpty()) return Collections.emptyMap();
        Map<Long, Boolean> result = new LinkedHashMap<>();
        employeeExtensions.findExtDigEmployeeByIds(sourceIds).forEach(employee ->
            result.put(employee.getResourceId(), isPublishableEmployeeType(employee.getSsResExtDigEmployee())));
        return result;
    }

    private boolean isPublishSource(SsResource resource) {
        return isEmployee(resource) && "personal".equals(resource.getOwnerType())
            && resource.getResourceId() != null
            && (Objects.equals(resource.getCreateBy(), CurrentUserHolder.getCurrentUserId()) || isAdministrator())
            && Objects.equals(resource.getResourceStatus(), 2) && Objects.equals(resource.getComAcctId(), CurrentUserHolder.getEnterpriseId())
            && !org.apache.commons.lang3.StringUtils.endsWithIgnoreCase(resource.getResourceCode(), "_main") && publicationEnabled();
    }

    /** 与发布快照校验一致：员工组和第三方接入员工不能走个人员工发布流程。 */
    private boolean isPublishableEmployeeType(SsResExtDigEmployee employee) {
        return employee != null && DigitalEmployType.isValid(employee.getAgentType())
            && !DigitalEmployeeGroupApplicationService.GROUP_AGENT_TYPE.equals(employee.getAgentType())
            && !"FROM_THIRD".equals(employee.getCreateType())
            && (org.apache.commons.lang3.StringUtils.isBlank(employee.getAgentDevType())
                || "byai".equals(employee.getAgentDevType()));
    }

    public boolean isProtected(SsResource resource) {
        // 停用“adminvip 创建的员工仅允许 adminvip 维护”；保留原判断，权限回归创建人及有效授权。
        // if (!isEmployee(resource) || resource.getCreateBy() == null || CurrentUserHolder.isAdminVip()) {
        //     return false;
        // }
        // return isAdminVipCreator(resource.getCreateBy());
        return false;
    }

    public boolean isAdminVipCreator(Long creatorId) {
        if (creatorId == null) return false;
        if (Objects.equals(creatorId, CurrentUserHolder.getCurrentUserId()) && CurrentUserHolder.isAdminVip()) return true;
        Users creator = users.findById(creatorId);
        return creator != null && "adminvip".equalsIgnoreCase(creator.getUserCode());
    }

    public void requireNotProtected(SsResource resource) {
        if (isProtected(resource)) {
            throw new BaseException("adminvip 创建的数字员工仅允许 adminvip 维护");
        }
    }

    public boolean canMaintainOfficial(SsResource resource) {
        return isOfficialCopy(resource) && !isProtected(resource)
            && Objects.equals(resource.getComAcctId(), CurrentUserHolder.getEnterpriseId())
            && (isAdministrator() || Objects.equals(resource.getCreateBy(), CurrentUserHolder.getCurrentUserId()));
    }

    public boolean canAdministerOfficial(SsResource resource) {
        return isOfficialCopy(resource) && !isProtected(resource) && isAdministrator()
            && Objects.equals(resource.getComAcctId(), CurrentUserHolder.getEnterpriseId());
    }

    public static void requireEnterpriseCreationAllowed(String ownerType) {
        if ("enterprise".equals(org.apache.commons.lang3.StringUtils.trim(ownerType)) && !isAdministrator()) {
            throw new BaseException("仅 adminvip 和平台管理员可以创建企业数字员工");
        }
    }

    public void requireDirectMutationAllowed(SsResource resource) {
        requireNotProtected(resource);
        if (isOfficialCopy(resource)) {
            if (!canAdministerOfficial(resource)) {
                throw new BaseException("创建者的修改需提交更新审核，审核通过前在用版本保持不变");
            }
            // 调用方已锁定官方副本；申请准备同样锁定副本，避免旧候选版本覆盖直接保存的配置。
            if (publications.active(resource.getPublicationSourceId(), resource.getComAcctId()) != null) {
                throw new BaseException("该员工已有未完成的更新申请，请先在审核中心处理或撤回申请后再保存");
            }
        }
    }
}
