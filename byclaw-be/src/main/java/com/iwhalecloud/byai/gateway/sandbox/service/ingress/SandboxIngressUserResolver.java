package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import java.util.HashMap;

import org.apache.commons.lang3.StringUtils;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;

@Service
public class SandboxIngressUserResolver {

    private final JwtService jwtService;
    private final LoginApplicationService loginApplicationService;

    public SandboxIngressUserResolver(JwtService jwtService,
                                      @Lazy LoginApplicationService loginApplicationService) {
        this.jwtService = jwtService;
        this.loginApplicationService = loginApplicationService;
    }

    public SandboxIngressUserContext resolve(String beyondToken) {
        if (StringUtils.isBlank(beyondToken)) {
            return new SandboxIngressUserContext(null, null);
        }

        LoginInfo loginInfo = jwtService.verifyJwt(beyondToken, LoginInfo.class);
        if (loginInfo == null) {
            return new SandboxIngressUserContext(beyondToken, null);
        }

        String userCode = loginInfo.getUserCode();
        if (StringUtils.isBlank(userCode)) {
            return new SandboxIngressUserContext(beyondToken, loginInfo);
        }

        try {
            LoginInfo dbLoginInfo = loginApplicationService.getLoginInfo(userCode);
            mergeRuntimeFields(dbLoginInfo, loginInfo);
            return new SandboxIngressUserContext(beyondToken, dbLoginInfo);
        }
        catch (Exception e) {
            return new SandboxIngressUserContext(beyondToken, loginInfo);
        }
    }

    private void mergeRuntimeFields(LoginInfo dbLoginInfo, LoginInfo currentLoginInfo) {
        if (dbLoginInfo == null || currentLoginInfo == null) {
            return;
        }
        if (StringUtils.isBlank(dbLoginInfo.getSessionId())) {
            dbLoginInfo.setSessionId(currentLoginInfo.getSessionId());
        }
        if (StringUtils.isBlank(dbLoginInfo.getFilterType())) {
            dbLoginInfo.setFilterType(currentLoginInfo.getFilterType());
        }
        if (StringUtils.isBlank(dbLoginInfo.getLoginType())) {
            dbLoginInfo.setLoginType(currentLoginInfo.getLoginType());
        }
        if (dbLoginInfo.getParamMap() == null || dbLoginInfo.getParamMap().isEmpty()) {
            dbLoginInfo.setParamMap(currentLoginInfo.getParamMap() != null
                ? currentLoginInfo.getParamMap()
                : new HashMap<>());
        }
    }
}
