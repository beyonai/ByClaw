package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.LinkedHashMap;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.model.opendesign.OpenDesignRequestEnvironment;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressEndpointResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRequestContext;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeSupport;

/**
 * Resolves Open Design access through the same dynamic sandbox endpoint model as /openDesign/**.
 */
@Service
public class OpenDesignEndpointResolver {

    public static final String OPEN_DESIGN_INSTANCE = "openDesign";
    public static final String OPEN_DESIGN_ROUTE_PREFIX = "/openDesign";

    private final SandboxProperties sandboxProperties;
    private final SandboxIngressEndpointResolver endpointResolver;
    private final SandboxIngressRuntimeResolver runtimeResolver;
    private final JwtService jwtService;

    public OpenDesignEndpointResolver(SandboxProperties sandboxProperties,
                                      SandboxIngressEndpointResolver endpointResolver,
                                      SandboxIngressRuntimeResolver runtimeResolver,
                                      JwtService jwtService) {
        this.sandboxProperties = sandboxProperties;
        this.endpointResolver = endpointResolver;
        this.runtimeResolver = runtimeResolver;
        this.jwtService = jwtService;
    }

    public OpenDesignRequestEnvironment resolve() {
        OpenDesignRequestEnvironment env = new OpenDesignRequestEnvironment();
        String userCode = resolveUserCode();
        String upstreamEndpoint = endpointResolver.resolveRequiredEndpoint(userCode, OPEN_DESIGN_INSTANCE);
        SandboxIngressRuntimeSupport runtimeSupport = runtimeResolver.resolve();
        String daemonBaseUrl = runtimeSupport.buildTargetUrl(upstreamEndpoint, OPEN_DESIGN_ROUTE_PREFIX, null)
            .toString();
        env.setDaemonBaseUrl(StringUtils.removeEnd(daemonBaseUrl, "/"));
        env.setRedirectRoutePrefix(OPEN_DESIGN_ROUTE_PREFIX);
        env.setAgentId(sandboxProperties.getOpenDesignAgentId());
        env.setDefaultSkillId(sandboxProperties.getOpenDesignDefaultSkillId());
        env.setDefaultDesignSystemId(sandboxProperties.getOpenDesignDefaultDesignSystemId());
        env.setHeaders(resolveHeaders(runtimeSupport, userCode, upstreamEndpoint));
        return env;
    }

    private Map<String, String> resolveHeaders(SandboxIngressRuntimeSupport runtimeSupport, String userCode,
        String upstreamEndpoint) {
        Map<String, String> headers = new LinkedHashMap<>();
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        String beyondToken = loginInfo != null ? jwtService.createJwt(loginInfo) : null;
        if (StringUtils.isNotBlank(beyondToken)) {
            headers.put("Beyond-Token", beyondToken.trim());
        }

        SandboxIngressRequestContext requestContext = new SandboxIngressRequestContext(null, OPEN_DESIGN_INSTANCE,
            userCode, upstreamEndpoint, "GET", OPEN_DESIGN_ROUTE_PREFIX, null, null, beyondToken, loginInfo,
            headers);
        okhttp3.Request.Builder requestBuilder = new okhttp3.Request.Builder().url("http://127.0.0.1/");
        runtimeSupport.customizeRequest(requestBuilder, requestContext);
        okhttp3.Headers customizedHeaders = requestBuilder.build().headers();
        for (String name : customizedHeaders.names()) {
            headers.put(name, customizedHeaders.get(name));
        }
        return headers;
    }

    private String resolveUserCode() {
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        if (loginInfo != null && StringUtils.isNotBlank(loginInfo.getUserCode())) {
            return loginInfo.getUserCode();
        }
        return CurrentUserHolder.getCurrentUserCode();
    }
}
