package com.iwhalecloud.byai.manager.security.login.phone;

import java.util.List;

import org.apache.commons.collections.CollectionUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.InternalAuthenticationServiceException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.login.service.SafeAccountMsgService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.login.SafeAccountMsg;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.security.exception.bean.LoginAuthenticationException;
import com.iwhalecloud.byai.common.constants.login.LoginType;
import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.constants.Constants;

/**
 * @author he.duming
 * @date 2025-05-02 14:12:45
 * @description 手机号验证码登录认证
 */
@Component
public class PhoneAuthenticationProvider implements AuthenticationProvider {

    @Autowired
    private UserService userService;

    @Autowired
    private SafeAccountMsgService safeAccountMsgService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    public PhoneAuthenticationProvider() {
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
        try {
            return authenticatePhone(authentication);
        }
        catch (DataAccessException exception) {
            throw new InternalAuthenticationServiceException(I18nUtil.get("login.phone.service.unavailable"), exception);
        }
    }

    private Authentication authenticatePhone(Authentication authentication) {

        // 用户提交的手机号和短信验证码
        String phone = authentication.getPrincipal().toString();
        String verifyCode = authentication.getCredentials().toString();
        // 查数据库，匹配用户信息
        List<Users> linkedUsers = userService.findAllByUserPhone(phone);
        if (CollectionUtils.isEmpty(linkedUsers)) {
            throw new BadCredentialsException(I18nUtil.get("login.phone.account.not.bound"));
        }
        List<Users> activeUsers = linkedUsers.stream()
            .filter(user -> UserState.ACTIVE.equals(user.getState()))
            .toList();
        if (activeUsers.isEmpty()) {
            throw new BadCredentialsException(I18nUtil.get("login.phone.account.disabled"));
        }
        if (activeUsers.size() > 1) {
            throw new BadCredentialsException(I18nUtil.get("login.phone.account.ambiguous"));
        }
        Users users = activeUsers.get(0);
        String ssmCodeMd5 = Sm4Util.encrypt(verifyCode);

        // 找出过期时间大于当前时间的
        List<SafeAccountMsg> safeAccountMsgs = safeAccountMsgService.qryLastByPhone(phone, Constants.LOGIN);

        // 1.是否存在 则验证码已经过期
        if (CollectionUtils.isEmpty(safeAccountMsgs)) {
            throw new BadCredentialsException(I18nUtil.get("login.phone.verify.code.expired"));
        }
        // 2.验证码是否过期
        SafeAccountMsg msg = safeAccountMsgs.get(0);
        if (!msg.getVerifyCode().equals(ssmCodeMd5)) {
            throw new BadCredentialsException(I18nUtil.get("login.phone.verify.code.incorrect"));
        }

        // 修改所有验证码状态为已使用
        for (SafeAccountMsg safeAccountMsg : safeAccountMsgs) {
            safeAccountMsg.setState(SafeAccountMsg.STATE_EXPIRED);
            safeAccountMsgService.update(safeAccountMsg);
        }

        // 检查用户是否有效
        String checkResult = loginApplicationService.checkUserIsValid(users);
        if (StringUtil.isNotEmpty(checkResult)) {
            throw new LoginAuthenticationException(users.getUserId(), LoginType.PHONE, null, checkResult);
        }

        // 认证通过，返回token
        PhoneAuthentication token = new PhoneAuthentication();
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
        return authentication.isAssignableFrom(PhoneAuthentication.class);
    }
}
