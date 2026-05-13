package com.iwhalecloud.byai.manager.security.login.sso;

import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.manager.security.login.iwhale.IwhaleAuthentication;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.login.bean.JwtUserInfo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.stereotype.Component;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.security.exception.bean.LoginAuthenticationException;
import com.iwhalecloud.byai.common.constants.login.LoginType;

/**
 * @author he.duming
 * @date 2025-05-02 14:12:45
 * @description 账号密码登录认证
 */
@Component
public class SSOAuthenticationProvider implements AuthenticationProvider {

    @Autowired
    private UserService userService;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    public SSOAuthenticationProvider() {
        super();
    }

    /**
     * 登陆认证
     *
     * @param authentication 认证信息
     * @return Authentication
     * @throws AuthenticationException
     */
    @Override
    public Authentication authenticate(Authentication authentication) throws AuthenticationException {

        // 获取授权认证token信息
        // String systemCode = authentication.getPrincipal().toString();
        String beyondToken = authentication.getCredentials().toString();

        JwtUserInfo jwtUserInfo = jwtService.verifyJwt(beyondToken, JwtUserInfo.class);

        // 验证登陆用户
        Users users = userService.findByUserCode(jwtUserInfo.getUserCode());

        // 检查用户是否有效
        String checkResult = loginApplicationService.checkUserIsValid(users);
        if (StringUtil.isNotEmpty(checkResult)) {
            throw new LoginAuthenticationException(users.getUserId(), LoginType.SSO, null, checkResult);
        }

        // 认证通过，返回token
        IwhaleAuthentication token = new IwhaleAuthentication();
        token.setUsers(users);
        token.setAuthenticated(true);

        return token;
    }

    /**
     * 类型的支持
     *
     * @param authentication 认证信息
     * @return supports
     */
    @Override
    public boolean supports(Class<?> authentication) {
        return authentication.isAssignableFrom(SSOAuthentication.class);
    }
}
