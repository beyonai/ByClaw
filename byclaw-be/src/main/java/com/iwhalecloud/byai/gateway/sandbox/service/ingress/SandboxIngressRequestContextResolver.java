package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import java.util.LinkedHashMap;
import java.util.Map;

import jakarta.servlet.http.HttpServletRequest;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;

import okhttp3.HttpUrl;

@Service
public class SandboxIngressRequestContextResolver {

    private static final Logger log = LoggerFactory.getLogger(SandboxIngressRequestContextResolver.class);

    private final SandboxIngressEndpointResolver endpointResolver;
    private final SandboxIngressRuntimeResolver runtimeResolver;
    private final JwtService jwtService;

    public SandboxIngressRequestContextResolver(SandboxIngressEndpointResolver endpointResolver,
                                                SandboxIngressRuntimeResolver runtimeResolver,
                                                JwtService jwtService) {
        this.endpointResolver = endpointResolver;
        this.runtimeResolver = runtimeResolver;
        this.jwtService = jwtService;
    }

    public SandboxIngressRequestContext resolve(HttpServletRequest request,
                                                String instance,
                                                String requestPath) {
        SandboxIngressInstanceType instanceType = SandboxIngressInstanceType.from(instance);
        String queryString = request.getQueryString();
        String incomingBeyondToken = resolveIncomingBeyondToken(request);
        log.debug("Resolving ingress context: instance={}, requestPath={}, query={}, beyondToken={}",
            instance, requestPath, queryString, maskToken(incomingBeyondToken));
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        String userCode = resolveUserCode(loginInfo);
        log.debug("Ingress user resolved from CurrentUserHolder: instance={}, userCode={}, loginInfoPresent={}",
            instance, userCode, loginInfo != null);
        String upstreamEndpoint = endpointResolver.resolveRequiredEndpoint(userCode, instance);
        HttpUrl targetUrl = runtimeResolver.resolve().buildTargetUrl(upstreamEndpoint, requestPath, queryString);
        log.debug("Ingress target resolved: instance={}, userCode={}, upstreamEndpoint={}, targetUrl={}",
            instance, userCode, upstreamEndpoint, targetUrl);
        Map<String, String> extraHeaders = new LinkedHashMap<>(2);
        String forwardBeyondToken = resolveForwardBeyondToken(request, loginInfo, incomingBeyondToken);
        if (StringUtils.isBlank(request.getHeader("Beyond-Token")) && StringUtils.isNotBlank(forwardBeyondToken)) {
            extraHeaders.put("Beyond-Token", forwardBeyondToken);
            log.debug("Injecting Beyond-Token header for ingress request: instance={}, userCode={}, token={}",
                instance, userCode, maskToken(forwardBeyondToken));
        }
        return new SandboxIngressRequestContext(instanceType, instance, userCode, upstreamEndpoint, request.getMethod(),
            requestPath, queryString, targetUrl, forwardBeyondToken, loginInfo, extraHeaders);
    }

    public SandboxIngressRequestContext resolveOpenSandboxPath(HttpServletRequest request,
                                                               String requestPath) {
        String queryString = request.getQueryString();
        String incomingBeyondToken = resolveIncomingBeyondToken(request);
        log.debug("Resolving direct OpenSandbox ingress context: requestPath={}, query={}, beyondToken={}",
            requestPath, queryString, maskToken(incomingBeyondToken));
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        String userCode = resolveUserCode(loginInfo);
        HttpUrl targetUrl = runtimeResolver.resolve().buildTargetUrl(requestPath, "", queryString);
        Map<String, String> extraHeaders = new LinkedHashMap<>(2);
        String forwardBeyondToken = resolveForwardBeyondToken(request, loginInfo, incomingBeyondToken);
        if (StringUtils.isBlank(request.getHeader("Beyond-Token")) && StringUtils.isNotBlank(forwardBeyondToken)) {
            extraHeaders.put("Beyond-Token", forwardBeyondToken);
            log.debug("Injecting Beyond-Token header for direct OpenSandbox request: userCode={}, token={}",
                userCode, maskToken(forwardBeyondToken));
        }
        return new SandboxIngressRequestContext(SandboxIngressInstanceType.UNKNOWN, "opensandbox", userCode,
            requestPath, request.getMethod(), "", queryString, targetUrl, forwardBeyondToken, loginInfo, extraHeaders);
    }

    private String resolveIncomingBeyondToken(HttpServletRequest request) {
        String headerToken = request.getHeader("Beyond-Token");
        if (StringUtils.isNotBlank(headerToken)) {
            return headerToken.trim();
        }
        String queryToken = request.getParameter("beyondToken");
        if (StringUtils.isNotBlank(queryToken)) {
            return queryToken.trim();
        }
        return null;
    }

    private String resolveForwardBeyondToken(HttpServletRequest request, LoginInfo loginInfo, String incomingBeyondToken) {
        String headerToken = request.getHeader("Beyond-Token");
        if (StringUtils.isNotBlank(headerToken)) {
            return headerToken.trim();
        }
        if (loginInfo != null) {
            String generatedToken = jwtService.createJwt(loginInfo);
            if (StringUtils.isNotBlank(generatedToken)) {
                return generatedToken.trim();
            }
        }
        return incomingBeyondToken;
    }

    private String resolveUserCode(LoginInfo loginInfo) {
        if (loginInfo != null && StringUtils.isNotBlank(loginInfo.getUserCode())) {
            return loginInfo.getUserCode();
        }
        return CurrentUserHolder.getCurrentUserCode();
    }

    private String maskToken(String token) {
        if (StringUtils.isBlank(token)) {
            return "<empty>";
        }
        String normalized = token.trim();
        if (normalized.length() <= 8) {
            return normalized;
        }
        return normalized.substring(0, 4) + "..." + normalized.substring(normalized.length() - 4);
    }
}
