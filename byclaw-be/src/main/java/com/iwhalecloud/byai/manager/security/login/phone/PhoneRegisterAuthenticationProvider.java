package com.iwhalecloud.byai.manager.security.login.phone;

import java.util.List;

import org.apache.commons.collections.CollectionUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.manager.application.service.user.UserApplicationService;
import com.iwhalecloud.byai.manager.domain.login.service.SafeAccountMsgService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.login.SafeAccountMsg;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.constants.Constants;

/**
 * @author he.duming
 * @date 2025-05-02 14:12:45
 * @description 账号密码登录认证
 */
@Component
public class PhoneRegisterAuthenticationProvider implements AuthenticationProvider {

    @Autowired
    private UserService userService;

    @Autowired
    private SafeAccountMsgService safeAccountMsgService;

    @Autowired
    private UserApplicationService userApplicationService;

    public PhoneRegisterAuthenticationProvider() {
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

        // 用户提交的手机号和短信验证码
        String phone = authentication.getPrincipal().toString();
        String verifyCode = authentication.getCredentials().toString();

        Users users = userService.findByUserPhone(phone);
        if (users != null) {
            throw new BadCredentialsException(I18nUtil.get("phone.register.user.exists"));
        }

        // 找出过期时间大于当前时间的
        List<SafeAccountMsg> msgList = safeAccountMsgService.qryLastByPhone(phone, Constants.REGISTER);

        // 1.是否存在
        if (CollectionUtils.isEmpty(msgList)) {
            throw new BadCredentialsException(I18nUtil.get("phone.register.code.expired"));
        }

        // 2.验证码是否过期
        SafeAccountMsg msg = msgList.get(0);
        // 查数据库，匹配用户信息
        if (!msg.getVerifyCode().equals(Sm4Util.encrypt(verifyCode))) {
            throw new BadCredentialsException(I18nUtil.get("phone.register.code.incorrect"));
        }

        // 修改所有验证码状态为已使用
        for (SafeAccountMsg safeAccountMsg : msgList) {
            safeAccountMsg.setState(SafeAccountMsg.STATE_EXPIRED);
            safeAccountMsgService.update(safeAccountMsg);
        }

        users = userApplicationService.registerByPhone(phone);

        // 认证通过，返回token
        PhoneRegisterAuthentication token = new PhoneRegisterAuthentication();
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
        return authentication.isAssignableFrom(PhoneRegisterAuthentication.class);
    }
}
