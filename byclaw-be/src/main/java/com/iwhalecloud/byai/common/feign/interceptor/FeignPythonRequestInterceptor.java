package com.iwhalecloud.byai.common.feign.interceptor;

import com.iwhalecloud.byai.common.constants.resource.SystemCode;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.StringUtil;
import feign.RequestInterceptor;
import feign.RequestTemplate;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Python服务统一认证拦截器，补齐数字员工稽核调用所需的鉴权信息
 */
public class FeignPythonRequestInterceptor implements RequestInterceptor {

    @Autowired
    private JwtService jwtService;

    @Override
    public void apply(RequestTemplate template) {

        String sessionId = CurrentUserHolder.getSessionId();
        if (StringUtil.isNotEmpty(sessionId)) {
            template.header("Cookie", String.format("SESSION=%s; PORTAL-SESSION=%s", sessionId, sessionId));
        }
        else {
            LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
            template.header("System-Code", SystemCode.BYAI.getCode());
            template.header("Beyond-Token", jwtService.createJwt(loginInfo));
        }
    }

}
