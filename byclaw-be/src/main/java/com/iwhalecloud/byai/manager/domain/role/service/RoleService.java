package com.iwhalecloud.byai.manager.domain.role.service;

import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.util.StringUtil;
import org.springframework.stereotype.Service;

/**
 * @author he.duming
 * @date 2025-05-31 22:24:24
 * @description TODO
 */
@Service
public class RoleService {

    /**
     * 获取角色名称
     * 
     * @param userType 用户类型
     * @return 角色名称
     */
    public String getCacheRoleName(String userType) {

        if (StringUtil.isEmpty(userType)) {
            return null;
        }

        return switch (userType) {
            case UserType.PLAT_MAN -> "平台管理";
            case UserType.ORG_MAN -> "组织管理";
            case UserType.PLAT_DEVOPS -> "平台运维";
            case UserType.BUSINESS_MAN -> "业务管理";
            case UserType.ORD_USER -> "普通用户";
            default -> null;
        };
    }

}
