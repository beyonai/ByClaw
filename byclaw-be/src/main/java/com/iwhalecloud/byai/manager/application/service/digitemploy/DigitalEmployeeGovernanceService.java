package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.Objects;
import org.springframework.stereotype.Service;

/** Rules specific to employee publication; platform roles never override adminvip ownership.
 * @author qin.guoquan
 * @date 2026-09-27 22:38:38
 * */
@Service
public class DigitalEmployeeGovernanceService {
    private final UserService users;
    private final ByaiSystemConfigService config;

    public DigitalEmployeeGovernanceService(UserService users, ByaiSystemConfigService config) {
        this.users = users;
        this.config = config;
    }

    public boolean publicationEnabled() {
        return "openSource".equalsIgnoreCase(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION"));
    }

    public static boolean isAdministrator() {
        return CurrentUserHolder.isAdminVip() || CurrentUserHolder.isPlatformManager();
    }

    public static boolean isEmployee(SsResource resource) {
        return resource != null && "DIG_EMPLOYEE".equals(resource.getResourceBizType());
    }

    public static boolean isOfficialCopy(SsResource resource) {
        return isEmployee(resource) && resource.getPublicationSourceId() != null;
    }

    public static boolean isPublicationSkill(SsResource resource) {
        return resource != null && "SKILL".equals(resource.getResourceBizType()) && resource.getPublicationRequestId() != null;
    }

    public boolean canPublish(SsResource resource) {
        return isEmployee(resource) && "personal".equals(resource.getOwnerType())
            && Objects.equals(resource.getCreateBy(), CurrentUserHolder.getCurrentUserId())
            && Objects.equals(resource.getResourceStatus(), 2) && Objects.equals(resource.getComAcctId(), CurrentUserHolder.getEnterpriseId())
            && !org.apache.commons.lang3.StringUtils.endsWithIgnoreCase(resource.getResourceCode(), "_main") && publicationEnabled();
    }

    public boolean isProtected(SsResource resource) {
        if (!isEmployee(resource) || resource.getCreateBy() == null || CurrentUserHolder.isAdminVip()) {
            return false;
        }
        Users creator = users.findById(resource.getCreateBy());
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
            throw new BaseException("请通过发布流程编辑官方副本，审核通过前在用版本保持不变");
        }
    }
}
