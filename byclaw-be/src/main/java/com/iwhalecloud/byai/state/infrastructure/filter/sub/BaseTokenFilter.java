package com.iwhalecloud.byai.state.infrastructure.filter.sub;

import java.util.Date;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UserStation;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.time.DateUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;
import org.springframework.stereotype.Component;
import com.alibaba.fastjson.JSON;
import com.auth0.jwt.JWT;
import com.auth0.jwt.JWTCreator;
import com.auth0.jwt.JWTVerifier;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.interfaces.Claim;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import io.jsonwebtoken.ExpiredJwtException;

/**
 * @author he.duming
 * @date 2025-07-08 10:55:00
 * @description 单点登陆认证token
 */
@Component
public class BaseTokenFilter {

    private Logger logger = LoggerFactory.getLogger(SsoTokenFilter.class);

    /**
     * 提供默认值：根据env注入
     */
    @Value("${sso.jwt.secret.key:43e3519132a1d22fb746a749b533627674c645908f23ae74be5a7b8f26dca768cf8f4a66a3741b38f3ed}")
    protected String ssoSecretKey;

    @Value("${sso.session.key.timeout:24}")
    protected int ssoSessionKeyTimeout;

    protected static final String SSO_REDIS_PREFIX = "SSO_SESSION_";

    @Autowired
    protected SessionRepository sessionRepository;

    @Autowired
    private LoginApplicationService loginApplicationService;

    /**
     * 认证处理
     *
     * @param ssoToken 令牌
     * @return boolean
     */
    public boolean doFilter(String ssoToken) {

        try {

            // 验证签名
            JWTVerifier verifier = JWT.require(Algorithm.HMAC256(this.ssoSecretKey)).build();
            DecodedJWT decodedJWT = verifier.verify(ssoToken);

            // 解析数据内容
            Map<String, Claim> claims = decodedJWT.getClaims();
            Long id = this.getLong(claims.get("id"));
            String code = this.getString(claims.get("code"));
            String name = this.getString(claims.get("name"));

            logger.info("获取到sso-token登陆用户信息,id={},code={},name={}", id, code, name);

            String sessionId = RedisUtil.getString(SSO_REDIS_PREFIX.concat(code));
            Session session = sessionRepository.findById(sessionId);
            // 如果sessionId已经过期，重新获取新的登陆的session
            if (session == null) {
                session = this.createNewSession(code);
                RedisUtil.setStringExp(SSO_REDIS_PREFIX.concat(code), session.getId(), ssoSessionKeyTimeout,
                    TimeUnit.HOURS);
            }

            LoginInfo userInfo = this.buildUserInfo(session);
            userInfo.setSessionId(session.getId());

            // 设置到当前线程中去
            CurrentUserHolder.setLoginInfo(userInfo);
            return true;
        }
        catch (ExpiredJwtException e) {
            logger.error(e.getMessage(), e);
            throw new BadCredentialsException(I18nUtil.get("exception.sso.token.expired"));
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BadCredentialsException(I18nUtil.get("exception.sso.token.failed"));
        }
    }

    /**
     * 创建用户信息
     *
     * @param userCode 单点登陆token
     * @return Session
     */
    protected Session createNewSession(String userCode) {

        return null;
    }

    /**
     * 获取整数
     *
     * @param claim 类型
     * @return Long
     */
    private Long getLong(Claim claim) {
        return claim != null ? claim.asLong() : null;
    }

    /**
     * 获取字符串
     *
     * @param claim
     * @return String
     */
    private String getString(Claim claim) {
        return claim != null ? claim.asString() : null;
    }

    /***
     * 是否的百应门户共享session
     *
     * @return boolean 是否推带session
     */
    protected LoginInfo buildUserInfo(Session session) {

        LoginInfo userInfo = new LoginInfo();
        userInfo.setUserId(this.getSessionLong(session, "userId"));
        userInfo.setUserCode(this.getSessionString(session, "userCode"));
        userInfo.setUserName(this.getSessionString(session, "userName"));
        userInfo.setAssistantId(this.getSessionLong(session, "assistantId"));
        userInfo.setDefaultDigEmployeeId(this.getSessionLong(session, "defaultDigEmployeeId"));
        userInfo.setEnterpriseId(this.getSessionLong(session, "enterpriseId"));
        userInfo.setComAcctId(this.getSessionLong(session, "comAcctId"));
        userInfo.setSessionId(session.getId());

        // 用户组织列表和岗位
        String usersOrganizationJson = this.getSessionString(session, "usersOrganizations");
        if (usersOrganizationJson != null) {
            userInfo.setUsersOrganizations(JSON.parseArray(usersOrganizationJson, UsersOrganization.class));
        }
        // 用户驻地
        String userStationJson = this.getSessionString(session, "userStation");
        if (userStationJson != null) {
            userInfo.setUserStation(JSON.parseObject(userStationJson, UserStation.class));
        }
        return userInfo;
    }

    /**
     * 从session中获取属性
     *
     * @param session 会话信息
     * @param attributeName 属性名称
     * @return String
     */
    private String getSessionString(Session session, String attributeName) {
        Object attributeValue = session.getAttribute(attributeName);
        return attributeValue != null ? attributeValue.toString() : null;
    }

    /**
     * 从session中获取属性
     *
     * @param session 会话信息
     * @param attributeName 属性名称
     * @return Long
     */
    private Long getSessionLong(Session session, String attributeName) {
        String attributeValue = this.getSessionString(session, attributeName);
        return StringUtils.isNotEmpty(attributeValue) ? Long.parseLong(attributeValue) : null;
    }

    /**
     * 查找或者创建新的session信息
     *
     * @param userCode 用户编码
     * @return UserInfo
     */
    protected LoginInfo findOrBuildUerInfo(String userCode) {
        return loginApplicationService.getLoginInfo(userCode);
    }

    /**
     * 创建鲸加的token
     *
     * @return ResponseUtil
     */
    public String createSsoToken(String code) {
        Date expireDate = DateUtils.addHours(new Date(), this.ssoSessionKeyTimeout);
        // 生成token令牌
        JWTCreator.Builder builder = JWT.create();
        builder.withClaim("code", code);
        return builder.withExpiresAt(expireDate).sign(Algorithm.HMAC256(this.ssoSecretKey));
    }

}
