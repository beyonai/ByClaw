package com.iwhalecloud.byai.state.infrastructure.filter.sub;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UserStation;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Component;
import com.alibaba.fastjson.JSON;
import jakarta.servlet.http.HttpSession;

/**
 * @author he.duming
 * @date 2025-07-08 16:12:06
 * @description TODO
 */
@Component
public class SessionFilter {

    /**
     * 共享用户信息
     */
    public static final String SHARE_CURRENT_USER = "SHARE_CURRENT_USER";

    /**
     * 认证处理
     *
     * @param httpSession httpSession
     */
    public boolean doFilter(HttpSession httpSession) {

        LoginInfo userInfo = this.buildUserInfo(httpSession);

        // userInfo.setAccessType("SESSION");
        userInfo.setSessionId(httpSession.getId());

        // 设置到当前线程中去
        CurrentUserHolder.setLoginInfo(userInfo);

        return true;
    }

    /***
     * 是否的百应门户共享session
     *
     * @return boolean 是否推带session
     */
    private LoginInfo buildUserInfo(HttpSession httpSession) {

        String shareCurrentUser = httpSession.getAttribute(SHARE_CURRENT_USER) + "";
        LoginInfo userInfo = JSON.parseObject(shareCurrentUser, LoginInfo.class);
        userInfo.setSessionId(httpSession.getId());
        userInfo.setAssistantId(this.getSessionLong(httpSession, "assistantId"));
        userInfo.setSessionDatasetId(this.getSessionLong(httpSession, "sessionDatasetId"));
        userInfo.setDefaultDigEmployeeId(this.getSessionLong(httpSession, "defaultDigEmployeeId"));
        userInfo.setEnterpriseId(this.getSessionLong(httpSession, "enterpriseId"));
        userInfo.setComAcctId(this.getSessionLong(httpSession, "comAcctId"));

        // 用户组织列表和岗位
        String usersOrganizationJson = this.getSessionString(httpSession, "usersOrganizations");
        if (usersOrganizationJson != null) {
            userInfo.setUsersOrganizations(JSON.parseArray(usersOrganizationJson, UsersOrganization.class));
        }
        // 用户驻地
        String userStationJson = this.getSessionString(httpSession, "userStation");
        if (userStationJson != null) {
            userInfo.setUserStation(JSON.parseObject(userStationJson, UserStation.class));
        }
        return userInfo;
    }

    /**
     * 从session中获取属性
     *
     * @param httpSession 会话信息
     * @param attributeName 属性名称
     * @return String
     */
    private String getSessionString(HttpSession httpSession, String attributeName) {
        Object attributeValue = httpSession.getAttribute(attributeName);
        return attributeValue != null ? attributeValue.toString() : null;
    }

    /**
     * 从session中获取属性
     *
     * @param httpSession 会话信息
     * @param attributeName 属性名称
     * @return Long
     */
    private Long getSessionLong(HttpSession httpSession, String attributeName) {
        String attributeValue = this.getSessionString(httpSession, attributeName);
        return StringUtils.isNotEmpty(attributeValue) ? Long.parseLong(attributeValue) : null;
    }

}
