package com.iwhalecloud.byai.manager.security.login.username;

import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.common.util.StringUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.security.exception.bean.LoginAuthenticationException;
import com.iwhalecloud.byai.common.constants.login.LoginType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;

/**
 * @author he.duming
 * @date 2025-05-02 14:12:45
 * @description 账号密码登录认证
 */
@Component
public class UsernameAuthenticationProvider implements AuthenticationProvider {

    @Autowired
    private UserService userService;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private LoginApplicationService loginApplicationService;

    public UsernameAuthenticationProvider() {
        super();
    }

    /**
     * 登陆认证
     *
     * @param authentication 认证信息
     * @return Authentication
     * @throws AuthenticationException 异常
     */
    @Override
    public Authentication authenticate(Authentication authentication) throws AuthenticationException {

        // 用户提交的用户名 + 密码
        String accountCode = authentication.getPrincipal().toString();
        String accountPwd = authentication.getCredentials().toString();

        // 查数据库，匹配用户信息
        Users users = userService.findByUserCode(accountCode);
        if (users == null) {
            throw new BadCredentialsException(I18nUtil.get("login.auth.fail"));
        }

        // 记录用户登陆异常
        if (!passwordEncoder.matches(accountPwd, passwordEncoder.encode(users.getPwd()))) {
            throw new LoginAuthenticationException(users.getUserId(), LoginType.USERNAME, null,
                I18nUtil.get("login.password.user.error"));
        }

        // 检查用户是否有效
        String checkResult = loginApplicationService.checkUserIsValid(users);
        if (StringUtil.isNotEmpty(checkResult)) {
            throw new LoginAuthenticationException(users.getUserId(), LoginType.USERNAME, null, checkResult);
        }

        // 认证通过，返回token
        UsernameAuthentication token = new UsernameAuthentication();
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
        return authentication.isAssignableFrom(UsernameAuthentication.class);
    }
}
