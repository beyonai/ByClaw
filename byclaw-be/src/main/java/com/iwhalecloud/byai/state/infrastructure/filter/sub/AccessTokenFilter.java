package com.iwhalecloud.byai.state.infrastructure.filter.sub;

import java.util.Date;

import com.iwhalecloud.byai.common.constants.login.FilterType;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.token.service.UserAccessTokenService;
import com.iwhalecloud.byai.manager.entity.token.UserAccessToken;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.stereotype.Component;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;

import io.jsonwebtoken.ExpiredJwtException;

/**
 * @author he.duming
 * @date 2025-06-05 20:18:49
 * @description TODO
 */
@Component
public class AccessTokenFilter {

    private static final Logger logger = LoggerFactory.getLogger(AccessTokenFilter.class);

    @Autowired
    private UserAccessTokenService userAccessTokenService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    /**
     * 认证处理
     *
     * @param accessToken 令牌
     */
    public boolean doFilter(String accessToken) {

        try {
            UserAccessToken userAccessToken = userAccessTokenService.findByAccessToken(accessToken);

            if (userAccessToken == null) {
                throw new BadCredentialsException(I18nUtil.get("accesstokenfilter.info.error"));
            }

            Date endTime = userAccessToken.getEndTime();
            if (endTime != null && endTime.before(new Date())) {
                throw new BadCredentialsException(I18nUtil.get("accesstokenfilter.expired"));
            }

            LoginInfo loginInfo = loginApplicationService.getLoginInfo(userAccessToken.getUserId());
            loginInfo.setFilterType(FilterType.ACCESS_TOKEN_FILTER);

            // 设置到当前线程中去
            CurrentUserHolder.setLoginInfo(loginInfo);

            // 更新最后的活跃时间
            userAccessToken.setLastActiveTime(new Date());
            userAccessTokenService.update(userAccessToken);

            return true;
        }
        catch (ExpiredJwtException e) {
            logger.error(e.getMessage(), e);
            // 转换异常，指定code，让前端知道时token过期，去调刷新token接口
            throw new BadCredentialsException(I18nUtil.get("accesstokenfilter.auth.expired"));
        }
        catch (Exception e) {
            throw new BadCredentialsException(I18nUtil.get("accesstokenfilter.auth.exception"));
        }
    }
}
