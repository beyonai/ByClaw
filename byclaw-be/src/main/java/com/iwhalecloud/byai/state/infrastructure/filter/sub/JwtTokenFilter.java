package com.iwhalecloud.byai.state.infrastructure.filter.sub;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import com.iwhalecloud.byai.common.jwt.JwtAuthentication;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import io.jsonwebtoken.ExpiredJwtException;

/**
 * @author he.duming
 * @date 2025-07-08 16:12:38
 * @description TODO
 */
@Component
public class JwtTokenFilter extends BaseTokenFilter {

    private Logger logger = LoggerFactory.getLogger(JwtTokenFilter.class);

    @Autowired
    private JwtService jwtService;

    /**
     * token方式
     *
     * @param systemCode 系统统驭
     * @param jwtToken jwtToken
     * @return boolean
     */
    public boolean doFilter(String systemCode, String jwtToken) {

        try {

            LoginInfo userInfo = jwtService.verifyJwt(jwtToken, LoginInfo.class);

            if (userInfo == null) {
                throw new RuntimeException(I18nUtil.get("jwt.token.filter.signature.null"));
            }

            // 设置true，认证通过。
            JwtAuthentication authentication = new JwtAuthentication();
            authentication.setJwtToken(jwtToken);
            authentication.setAuthenticated(true);

            // 认证通过后，一定要设置到SecurityContextHolder里面去。
            SecurityContextHolder.getContext().setAuthentication(authentication);

            // 其他系统生成Beyond-Token用户信息对齐， BYAI：百应，BOT：博特，WHALE+：鲸+，UIAGENT：界面智能体
            if ("UIAGENT".equalsIgnoreCase(systemCode) || "BOT".equalsIgnoreCase(systemCode)
                || "AiCollect".equalsIgnoreCase(systemCode) || "Aigc".equalsIgnoreCase(systemCode)
                || "InductionTraining".equalsIgnoreCase(systemCode) || "BYAI".equalsIgnoreCase(systemCode)
                || "ProductQuality".equalsIgnoreCase(systemCode)) {
                String userCode = userInfo.getUserCode();
                userInfo = super.findOrBuildUerInfo(userCode);
            }

            // 设置到当前线程中去
            CurrentUserHolder.setLoginInfo(userInfo);
            return true;

        }
        catch (ExpiredJwtException e) {
            logger.error(e.getMessage(), e);

            // 转换异常，指定code，让前端知道时token过期，去调刷新token接口
            throw new BadCredentialsException(I18nUtil.get("jwt.token.filter.beyond.token.expiration"), e);

        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BadCredentialsException(I18nUtil.get("jwt.token.filter.beyond.token.exception"), e);
        }
    }

}
