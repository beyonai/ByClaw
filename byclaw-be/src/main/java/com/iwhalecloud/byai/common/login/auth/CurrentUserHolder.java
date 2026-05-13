package com.iwhalecloud.byai.common.login.auth;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import com.alibaba.fastjson.JSON;
import com.alibaba.ttl.TransmittableThreadLocal;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UserStation;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.common.util.StringUtil;

/**
 * @author he.duming
 * @date 2025-04-14 13:57:30
 * @description 获取当前用户账号工具类
 */
public final class CurrentUserHolder {

    private static final Logger logger = LoggerFactory.getLogger(CurrentUserHolder.class);


    private CurrentUserHolder() {
    }

    private static TransmittableThreadLocal<LoginInfo> threadLocal = new TransmittableThreadLocal<LoginInfo>();

    /**
     * 设置当前用户登陆信息到当前线程中
     *
     * @param loginInfo 登陆用户信息
     */
    public static void setLoginInfo(LoginInfo loginInfo) {
        threadLocal.set(loginInfo);
    }

    /**
     * 获取用户登陆信息
     *
     * @return LoginInfo
     */
    public static LoginInfo getLoginInfo() {
        return threadLocal.get();
    }

    /**
     * 清理当前线程中的登录信息。
     */
    public static void clearLoginInfo() {
        threadLocal.remove();
    }

    /**
     * 获取当前用户标识
     *
     * @return Long
     */
    public static Long getCurrentUserId() {
        LoginInfo loginInfo = threadLocal.get();
        return loginInfo != null ? loginInfo.getUserId() : Integer.MIN_VALUE;

    }

    /**
     * 获取当前用户编码
     *
     * @return String
     */
    public static String getCurrentUserCode() {
        LoginInfo loginInfo = threadLocal.get();
        return loginInfo != null ? loginInfo.getUserCode() : null;
    }

    /**
     * 获取当前用户名称
     *
     * @return String
     */
    public static String getCurrentUserName() {
        LoginInfo loginInfo = threadLocal.get();
        return loginInfo != null ? loginInfo.getUserName() : null;
    }

    /**
     * 获取用户类型usersOrganizations
     *
     * @return String
     */
    public static List<UsersOrganization> getUsersOrganizations() {
        LoginInfo loginInfo = threadLocal.get();
        if (loginInfo == null) {
            return Collections.emptyList();
        }

        List<UsersOrganization> usersOrganizations = loginInfo.getUsersOrganizations();
        if (usersOrganizations == null) {
            return Collections.emptyList();
        }

        return usersOrganizations;
    }

    /***
     * 判断当前用户是否为平台管理员
     *
     * @return boolean
     */
    public static boolean isPlatformManager() {
        LoginInfo loginInfo = threadLocal.get();
        if (loginInfo == null) {
            return false;
        }

        List<UsersOrganization> usersOrganizations = loginInfo.getUsersOrganizations();
        if (usersOrganizations == null || usersOrganizations.isEmpty()) {
            return false;
        }

        // 查看是否平台管理员
        for (UsersOrganization usersOrganization : usersOrganizations) {
            if (UserType.PLAT_MAN.equals(usersOrganization.getUserType())) {
                return true;
            }
        }
        return false;
    }

    /***
     * 获取用户企业标识,如果有enterpriseId优先取，没有取comAcctId
     *
     * @return Long
     */
    public static Long getEnterpriseId() {
        LoginInfo loginInfo = threadLocal.get();
        if (loginInfo == null) {
            return null;
        }
        return loginInfo.getEnterpriseId() != null ? loginInfo.getEnterpriseId() : loginInfo.getComAcctId();
    }

    public static List<String> getUserTypes() {
        LoginInfo loginInfo = threadLocal.get();
        if (loginInfo == null) {
            return Collections.emptyList();
        }

        List<UsersOrganization> usersOrganizations = loginInfo.getUsersOrganizations();

        logger.info("当前用户权限是:{}", JSON.toJSONString(usersOrganizations));

        if (usersOrganizations == null || usersOrganizations.isEmpty()) {
            return Collections.emptyList();
        }

        // 提取所有角色类型
        List<String> userTypes = new ArrayList<>();
        for (UsersOrganization usersOrganization : usersOrganizations) {
            if (usersOrganization.getUserType() != null) {
                userTypes.add(usersOrganization.getUserType());
            }
        }

        return userTypes;
    }

    /**
     * 判断是否为平台管理或者平台运维人员
     *
     * @return
     */
    public static boolean isPlatformAdminOrOperator() {
        List<String> userTypes = getUserTypes();
        // 查看是否平台管理员
        if (userTypes == null || userTypes.isEmpty()) {
            return false;
        }
        if (userTypes.contains(UserType.PLAT_MAN) || userTypes.contains(UserType.PLAT_DEVOPS)) {
            return true;
        }
        return false;
    }

    // 判断是否是组织管理员
    public static boolean isOrganizationAdmin() {
        List<String> userTypes = getUserTypes();
        return userTypes.contains(UserType.ORG_MAN);
    }

    // 判断是否是业务管理员
    public static boolean isBusinessAdmin() {
        List<String> userTypes = getUserTypes();
        return userTypes.contains(UserType.BUSINESS_MAN);
    }

    // 获取用户的最高权限角色
    public static String getHighestUserType() {
        List<String> userTypes = getUserTypes();
        if (userTypes.isEmpty()) {
            return UserType.ORD_USER;
        }
        // 按照权限从高到低的顺序检查
        if (userTypes.contains(UserType.PLAT_MAN)) {
            return UserType.PLAT_MAN;
        }
        if (userTypes.contains(UserType.PLAT_DEVOPS)) {
            return UserType.PLAT_DEVOPS;
        }
        if (userTypes.contains(UserType.ORG_MAN)) {
            return UserType.ORG_MAN;
        }
        if (userTypes.contains(UserType.BUSINESS_MAN)) {
            return UserType.BUSINESS_MAN;
        }
        // 如果没有匹配到预定义的角色，则返回普通用户
        return UserType.ORD_USER;

    }

    /**
     * 获取用户的管理组织ID集合
     *
     * @return List<Long>
     */
    public static List<Long> getMangerOrgIds() {
        List<UsersOrganization> organization = getUsersOrganizations();
        List<Long> mangerOrgIds = new ArrayList<>(10);
        for (UsersOrganization usersOrganization : organization) {
            if (UserType.ORG_MAN.equals(usersOrganization.getUserType())) {
                mangerOrgIds.add(usersOrganization.getOrgId());
            }
        }
        return mangerOrgIds;
    }

    public static List<Long> getBelongOrgIds() {
        List<UsersOrganization> organization = getUsersOrganizations();
        List<Long> belongOrgIds = new ArrayList<>(10);
        for (UsersOrganization usersOrganization : organization) {
            // 加入组织和岗位
            String[] split = usersOrganization.getPathCode().split("\\.");
            // 遍历并添加，增加空值和空字符串检查
            for (String pathId : split) {
                if (pathId != null && !pathId.trim().isEmpty()) {
                    belongOrgIds.add(Long.parseLong(pathId));
                }
            }
            belongOrgIds.add(usersOrganization.getPositionId());
        }
        return belongOrgIds;
    }

    /**
     * 获取登陆拦截的类型
     *
     * @return String
     */
    public static String getFilterType() {
        LoginInfo loginInfo = threadLocal.get();
        return loginInfo != null ? loginInfo.getFilterType() : null;
    }

    /**
     * 获取驻地信息
     *
     * @return UserStation
     */
    public static UserStation getUserStation() {
        LoginInfo loginInfo = threadLocal.get();
        return loginInfo != null ? loginInfo.getUserStation() : null;
    }

    /**
     * 获取当前用户编码
     *
     * @return String
     */
    public static String getPhone() {
        LoginInfo loginInfo = threadLocal.get();
        return loginInfo != null ? loginInfo.getPhone() : null;
    }

    /**
     * 获取当前用户编码
     *
     * @return String
     */
    public static String getEmail() {
        LoginInfo loginInfo = threadLocal.get();
        return loginInfo != null ? loginInfo.getEmail() : null;
    }

    /***
     * 获取当前用户登陆的redis-session信息
     *
     * @return String
     */
    public static String getSessionId() {
        LoginInfo loginInfo = threadLocal.get();
        return loginInfo == null ? null : loginInfo.getSessionId();
    }

    /**
     * 获取超级助理
     *
     * @return Long
     */
    public static Long getAssistantId() {
        LoginInfo loginInfo = threadLocal.get();
        return loginInfo == null ? null : loginInfo.getAssistantId();
    }

    /**
     * 获取用户驻地标识
     *
     * @return Long
     */
    public static Long getUserStationId() {
        UserStation userStation = getUserStation();
        return userStation != null ? userStation.getStationId() : null;
    }

    /**
     * 获取用户岗位标识
     *
     * @return Long
     */
    public static List<Long> getUserPositionIds() {
        List<UsersOrganization> usersOrganizations = getUsersOrganizations();

        List<Long> userPositionIds = new ArrayList<>(10);
        for (UsersOrganization usersOrganization : usersOrganizations) {
            userPositionIds.add(usersOrganization.getPositionId());
        }

        return userPositionIds;
    }

    /**
     * 获取用户所有相关的组织标记
     *
     * @return Set
     */
    public static Set<Long> getUserOrgIds() {

        List<UsersOrganization> usersOrganizations = getUsersOrganizations();

        Set<Long> userOrgIds = new HashSet<>(10);

        for (int i = 0; usersOrganizations != null && i < usersOrganizations.size(); i++) {
            UsersOrganization usersOrganization = usersOrganizations.get(i);
            String pathCode = usersOrganization.getPathCode();
            List<Long> longs = StringUtil.splitLong(pathCode, "\\.");
            userOrgIds.addAll(longs);
        }
        return userOrgIds;
    }

    /**
     * 获取默认知识库
     *
     * @return Long
     */
    public static Long getSessionDatasetId() {
        LoginInfo loginInfo = getLoginInfo();
        return loginInfo.getSessionDatasetId();
    }

    /**
     * 获取默认个人助理数字员工ID
     *
     * @return Long
     */
    public static Long getDefaultDigEmployeeId() {
        LoginInfo loginInfo = getLoginInfo();
        return loginInfo == null ? null : loginInfo.getDefaultDigEmployeeId();
    }

}
