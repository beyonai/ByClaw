package com.iwhalecloud.byai.manager.security.login.apple;

import com.iwhalecloud.byai.manager.application.service.login.AppleLoginService;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.security.exception.bean.AppleUserBindRequiredException;
import com.iwhalecloud.byai.manager.security.exception.bean.LoginAuthenticationException;
import com.iwhalecloud.byai.common.constants.login.LoginType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.stereotype.Component;

/**
 * @description 苹果登录验证提供者
 * 处理苹果Sign In with Apple的认证逻辑
 */
@Component
public class AppleAuthenticationProvider implements AuthenticationProvider {

    private static final Logger logger = LoggerFactory.getLogger(AppleAuthenticationProvider.class);

    @Autowired
    private AppleLoginService appleLoginService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    @Override
    public Authentication authenticate(Authentication authentication) throws AuthenticationException {
        String identityToken = authentication.getPrincipal().toString();

        if (StringUtil.isEmpty(identityToken)) {
            throw new BadCredentialsException(I18nUtil.get("appleauthprovider.identity_token.notnull"));
        }

        try {
            // 验证苹果identity token
            AppleLoginService.AppleUserInfo appleUserInfo = appleLoginService.verifyIdentityToken(identityToken);
            
            logger.info("苹果登录验证成功: appleUserId={}, email={}", 
                appleUserInfo.getUserId(), appleUserInfo.getEmail());

            // 根据苹果用户ID查找已绑定的用户
            Users users = appleLoginService.findUserByAppleId(appleUserInfo);

            if (users == null) {
                // 用户未绑定，生成绑定Token，抛出需要绑定的异常
                logger.info("苹果用户未绑定系统账号，需要用户选择绑定方式: appleUserId={}", 
                    appleUserInfo.getUserId());
                
                String bindToken = appleLoginService.generateBindToken(appleUserInfo);
                
                throw new AppleUserBindRequiredException(
                    appleUserInfo.getUserId(),
                    appleUserInfo.getEmail(),
                    bindToken,
                    I18nUtil.get("appleauthprovider.bind.required")
                );
            }

            // 检查用户是否有效
            String checkResult = loginApplicationService.checkUserIsValid(users);
            if (StringUtil.isNotEmpty(checkResult)) {
                throw new LoginAuthenticationException(users.getUserId(), LoginType.APPLE, null, checkResult);
            }

            logger.info("苹果登录认证成功: userId={}, appleUserId={}", 
                users.getUserId(), appleUserInfo.getUserId());

            // 认证成功
            AppleAuthentication token = (AppleAuthentication) authentication;
            token.setUsers(users);
            token.setAuthenticated(true);

            return token;

        } catch (Exception e) {
            if (e instanceof AppleUserBindRequiredException) {
                throw (AppleUserBindRequiredException) e;
            }
            if (e instanceof AuthenticationException) {
                throw (AuthenticationException) e;
            }
            logger.error("苹果登录认证失败", e);
            throw new BadCredentialsException(I18nUtil.get("appleauthprovider.auth.fail") + ": " + e.getMessage(), e);
        }
    }

    @Override
    public boolean supports(Class<?> authentication) {
        return authentication.isAssignableFrom(AppleAuthentication.class);
    }
}