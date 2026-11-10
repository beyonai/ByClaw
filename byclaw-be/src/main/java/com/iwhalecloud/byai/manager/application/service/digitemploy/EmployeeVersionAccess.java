package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import java.util.Objects;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;

/** 版本与配置维护统一权限；平台/组织管理员角色本身不授予编辑权。 */
@Component
public class EmployeeVersionAccess {
    private final AuthApplicationService auth;
    public EmployeeVersionAccess(@Lazy AuthApplicationService auth) { this.auth = auth; }

    public boolean canManage(SsResource employee) {
        return employee != null && CurrentUserHolder.getCurrentUserId() != null
            && Objects.equals(employee.getComAcctId(), CurrentUserHolder.getEnterpriseId())
            && DigitalEmployeeGovernanceService.isEmployee(employee)
            && !Objects.equals(employee.getResourceStatus(), -1)
            && (CurrentUserHolder.isAdminVip()
                || Objects.equals(employee.getCreateBy(), CurrentUserHolder.getCurrentUserId())
                || auth.hasCurrentUserAllowManagePrivilege(employee));
    }

    public void requireManage(SsResource employee) {
        if (!canManage(employee)) throw new BaseException("仅创建者、有效管理授权人或超管可维护该数字员工版本");
    }
}
