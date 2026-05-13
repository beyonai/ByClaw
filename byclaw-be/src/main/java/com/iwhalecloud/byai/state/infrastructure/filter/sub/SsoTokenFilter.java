package com.iwhalecloud.byai.state.infrastructure.filter.sub;

import java.util.Map;
import java.util.concurrent.TimeUnit;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.session.Session;
import org.springframework.stereotype.Component;
import com.auth0.jwt.JWT;
import com.auth0.jwt.JWTVerifier;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.interfaces.Claim;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.i18n.I18nUtil;

import io.jsonwebtoken.ExpiredJwtException;

/**
 * @author he.duming
 * @date 2025-07-08 10:55:00
 * @description 单点登陆认证token
 */
@Component
public class SsoTokenFilter extends BaseTokenFilter {

    private Logger logger = LoggerFactory.getLogger(SsoTokenFilter.class);

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

}
