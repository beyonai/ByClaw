package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.function.Supplier;

import org.apache.commons.lang3.StringUtils;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;

/**
 * Binds LoginInfo for sandbox background flows that only carry userCode.
 */
@Service
public class SandboxUserContextRunner {

    private final LoginApplicationService loginApplicationService;

    public SandboxUserContextRunner(@Lazy LoginApplicationService loginApplicationService) {
        this.loginApplicationService = loginApplicationService;
    }

    public void runAsUser(String userCode, Runnable runnable) {
        callAsUser(userCode, () -> {
            runnable.run();
            return null;
        });
    }

    public <T> T callAsUser(String userCode, Supplier<T> supplier) {
        LoginInfo originalLoginInfo = CurrentUserHolder.getLoginInfo();
        CurrentUserHolder.setLoginInfo(buildLoginInfo(userCode));
        try {
            return supplier.get();
        }
        finally {
            if (originalLoginInfo != null) {
                CurrentUserHolder.setLoginInfo(originalLoginInfo);
            }
            else {
                CurrentUserHolder.clearLoginInfo();
            }
        }
    }

    private LoginInfo buildLoginInfo(String userCode) {
        LoginInfo loginInfo = loginApplicationService.getLoginInfo(userCode);
        if (loginInfo == null) {
            loginInfo = new LoginInfo();
        }
        if (StringUtils.isBlank(loginInfo.getUserCode())) {
            loginInfo.setUserCode(userCode);
        }
        return loginInfo;
    }
}
