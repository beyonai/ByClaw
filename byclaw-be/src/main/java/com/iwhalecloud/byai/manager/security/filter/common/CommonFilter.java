package com.iwhalecloud.byai.manager.security.filter.common;

import java.util.concurrent.TimeUnit;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;
import org.springframework.stereotype.Component;

/**
 * @author he.duming
 * @date 2025-07-08 10:55:00
 * @description 单点登陆认证token
 */
@Component
public class CommonFilter {

    protected static final String SSO_REDIS_PREFIX = "SSO_SESSION_";

    @Autowired
    protected SessionRepository sessionRepository;

    @Autowired
    private LoginApplicationService loginApplicationService;

    /**
     * @param request 用户登陆session信息
     * @param loginInfo 登陆信息
     * @return String
     */
    protected String findOrCreateNewSession(HttpServletRequest request, LoginInfo loginInfo) {

        String userCode = loginInfo.getUserCode();

        // 从缓存中捞取
        String sessionId = RedisUtil.getString(SSO_REDIS_PREFIX.concat(userCode));
        Session springSession = sessionRepository.findById(sessionId);

        // 如果sessionId已经过期，重新获取新的登陆的session
        if (springSession != null) {
            return springSession.getId();
        }
        else {

            // 是否产生新的session信息
            HttpSession httpSession = request.getSession(true);

            // 缓存
            String ssoRedisKey = SSO_REDIS_PREFIX.concat(userCode);
            loginApplicationService.shareSession(httpSession, loginInfo);
            RedisUtil.setStringExp(ssoRedisKey, httpSession.getId(), 24, TimeUnit.HOURS);

            return httpSession.getId();
        }
    }

}
