package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.HashMap;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.TypeReference;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;

/**
 * Builds the user identity payload passed into sandbox bootstrap from the same source as login.
 */
@Service
public class SandboxUserInfoFactory {

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxUserInfoFactory.class);

    private final LoginApplicationService loginApplicationService;

    public SandboxUserInfoFactory(@Lazy LoginApplicationService loginApplicationService) {
        this.loginApplicationService = loginApplicationService;
    }

    public Map<String, Object> build(String fallbackUserCode) {
        LoginInfo loginInfo = resolveLoginInfo(fallbackUserCode);
        if (loginInfo == null) {
            return buildFallbackUserInfo(fallbackUserCode);
        }

        Map<String, Object> userInfo = JSON.parseObject(JSON.toJSONString(loginInfo),
            new TypeReference<Map<String, Object>>() {
            });
        if (userInfo == null) {
            userInfo = new HashMap<>(4);
        }

        String userCode = StringUtils.defaultIfBlank(loginInfo.getUserCode(), fallbackUserCode);
        if (StringUtils.isNotBlank(userCode)) {
            userInfo.put("userCode", userCode);
        }
        putLongIfPresent(userInfo, "userId", loginInfo.getUserId());
        putLongIfPresent(userInfo, "assistantId", loginInfo.getAssistantId());
        putLongIfPresent(userInfo, "enterpriseId", loginInfo.getEnterpriseId());
        putLongIfPresent(userInfo, "comAcctId", loginInfo.getComAcctId());
        putLongIfPresent(userInfo, "sessionDatasetId", loginInfo.getSessionDatasetId());
        putLongIfPresent(userInfo, "defaultDigEmployeeId", loginInfo.getDefaultDigEmployeeId());
        userInfo.putIfAbsent("userId", "");
        userInfo.putIfAbsent("paramMap", new HashMap<String, String>());
        return userInfo;
    }

    private void putLongIfPresent(Map<String, Object> userInfo, String key, Long value) {
        if (value != null) {
            userInfo.put(key, value);
        }
    }

    private LoginInfo resolveLoginInfo(String fallbackUserCode) {
        LoginInfo currentLoginInfo = CurrentUserHolder.getLoginInfo();
        if (hasCompleteUserIdentity(currentLoginInfo)) {
            return currentLoginInfo;
        }

        String userCode = resolveUserCode(currentLoginInfo, fallbackUserCode);
        if (StringUtils.isBlank(userCode)) {
            return currentLoginInfo;
        }

        try {
            LoginInfo dbLoginInfo = loginApplicationService.getLoginInfo(userCode);
            mergeRuntimeFields(dbLoginInfo, currentLoginInfo);
            return dbLoginInfo;
        }
        catch (Exception e) {
            LOGGER.warn("根据 userCode 构建沙箱用户信息失败，userCode={}，使用当前上下文降级", userCode, e);
            if (currentLoginInfo != null) {
                currentLoginInfo.setUserCode(StringUtils.defaultIfBlank(currentLoginInfo.getUserCode(), userCode));
                return currentLoginInfo;
            }
            LoginInfo fallbackLoginInfo = new LoginInfo();
            fallbackLoginInfo.setUserCode(userCode);
            return fallbackLoginInfo;
        }
    }

    private boolean hasCompleteUserIdentity(LoginInfo loginInfo) {
        return loginInfo != null && loginInfo.getUserId() != null && StringUtils.isNotBlank(loginInfo.getUserCode());
    }

    private String resolveUserCode(LoginInfo currentLoginInfo, String fallbackUserCode) {
        if (currentLoginInfo != null && StringUtils.isNotBlank(currentLoginInfo.getUserCode())) {
            return currentLoginInfo.getUserCode();
        }
        return fallbackUserCode;
    }

    private void mergeRuntimeFields(LoginInfo dbLoginInfo, LoginInfo currentLoginInfo) {
        if (dbLoginInfo == null || currentLoginInfo == null) {
            return;
        }
        if (StringUtils.isBlank(dbLoginInfo.getSessionId())) {
            dbLoginInfo.setSessionId(currentLoginInfo.getSessionId());
        }
        if (StringUtils.isBlank(dbLoginInfo.getFilterType())) {
            dbLoginInfo.setFilterType(currentLoginInfo.getFilterType());
        }
        if (StringUtils.isBlank(dbLoginInfo.getLoginType())) {
            dbLoginInfo.setLoginType(currentLoginInfo.getLoginType());
        }
        if (dbLoginInfo.getParamMap() == null || dbLoginInfo.getParamMap().isEmpty()) {
            dbLoginInfo.setParamMap(currentLoginInfo.getParamMap());
        }
    }

    private Map<String, Object> buildFallbackUserInfo(String fallbackUserCode) {
        Map<String, Object> userInfo = new HashMap<>(4);
        userInfo.put("userId", "");
        userInfo.put("userCode", StringUtils.defaultString(fallbackUserCode));
        userInfo.put("paramMap", new HashMap<String, String>());
        return userInfo;
    }
}
