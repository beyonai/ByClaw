package com.iwhalecloud.byai.common.jwt;

import com.alibaba.fastjson.JSON;
import com.auth0.jwt.JWT;
import com.auth0.jwt.JWTCreator;
import com.auth0.jwt.algorithms.Algorithm;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.login.ShareSessionKey;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import org.apache.commons.lang3.time.DateUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;
import org.springframework.stereotype.Service;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

/**
 * @author he.duming
 * @date 2025-11-26 23:41:45
 * @description TODO
 */
@Service
public class SsoTokenService {

    private static final String SSO_REDIS_PREFIX = "SSO_SESSION_";

    /**
     * 提供默认值：根据env注入
     */
    @Value("${sso.jwt.secret.key:43e3519132a1d22fb746a749b533627674c645908f23ae74be5a7b8f26dca768cf8f4a66a3741b38f3ed}")
    protected String ssoSecretKey;

    @Value("${sso.session.key.timeout.hour:24}")
    protected int ssoSessionKeyTimeoutHour;

    @Autowired
    private SessionRepository sessionRepository;

    /**
     * 创建鲸加的token
     *
     * @return ResponseUtil
     */
    public String createSsoToken() {
        Date expireDate = DateUtils.addHours(new Date(), this.ssoSessionKeyTimeoutHour);
        // 生成token令牌
        JWTCreator.Builder builder = JWT.create();
        builder.withClaim("id", CurrentUserHolder.getCurrentUserId());
        builder.withClaim("code", CurrentUserHolder.getCurrentUserCode());
        builder.withClaim("name", CurrentUserHolder.getCurrentUserName());
        builder.withClaim("email", CurrentUserHolder.getEmail());
        builder.withClaim("phone", CurrentUserHolder.getPhone());
        return builder.withExpiresAt(expireDate).sign(Algorithm.HMAC256(this.ssoSecretKey));
    }

    /**
     * 从缓存中捞取session信息
     * 
     * @param userCode 用户编码
     * @return Session
     */
    public Session findSession(String userCode) {
        String sessionId = RedisUtil.getString(SSO_REDIS_PREFIX.concat(userCode));
        return sessionRepository.findById(sessionId);
    }

    /**
     * 创建共享信息
     * 
     * @return Session
     */
    public Session createSession(LoginInfo loginInfo) {

        Session session = sessionRepository.createSession();

        // 设置session共享
        session.setAttribute("userId", loginInfo.getUserId());
        session.setAttribute("userCode", loginInfo.getUserCode());
        session.setAttribute("userName", loginInfo.getUserName());
        session.setAttribute("assistantId", loginInfo.getAssistantId());
        session.setAttribute("enterpriseId", loginInfo.getEnterpriseId());
        session.setAttribute("loginType", loginInfo.getLoginType());
        session.setAttribute("usersOrganizations", JSON.toJSONString(loginInfo.getUsersOrganizations()));
        session.setAttribute("userStation", JSON.toJSONString(loginInfo.getUserStation()));

        // 封装原来门户参数
        Map<String, Object> shareCurrentUser = this.buildShareCurrentUserObjectMap(loginInfo);
        session.setAttribute(ShareSessionKey.USER_CODE, loginInfo.getUserCode());
        session.setAttribute(ShareSessionKey.SHARE_CURRENT_USER, JSON.toJSONString(shareCurrentUser));
        session.setAttribute(ShareSessionKey.SHARE_USERS_ORGANIZATIONS,
            JSON.toJSONString(loginInfo.getUsersOrganizations()));
        session.setAttribute(ShareSessionKey.SHARE_CURRENT_MANAGE_ORG,
            JSON.toJSONString(loginInfo.getUserManageOrgs()));

        // 保存session
        sessionRepository.save(session);

        return session;
    }

    /**
     * @param loginInfo 登陆用户信息
     * @return Map
     */
    public Map<String, Object> buildShareCurrentUserObjectMap(LoginInfo loginInfo) {
        Map<String, Object> shareCurrentUser = new HashMap<>(10);
        shareCurrentUser.put("userId", loginInfo.getUserId());
        shareCurrentUser.put("userCode", loginInfo.getUserCode());
        shareCurrentUser.put("userName", loginInfo.getUserName());
        shareCurrentUser.put("email", loginInfo.getEmail());
        shareCurrentUser.put("enterpriseId", loginInfo.getEnterpriseId());
        shareCurrentUser.put("comAcctId", loginInfo.getEnterpriseId());
        shareCurrentUser.put("phone", loginInfo.getPhone());
        return shareCurrentUser;
    }

}
