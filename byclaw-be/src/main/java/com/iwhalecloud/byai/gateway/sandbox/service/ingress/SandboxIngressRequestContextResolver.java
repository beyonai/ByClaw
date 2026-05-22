package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import java.util.LinkedHashMap;
import java.util.Map;

import jakarta.servlet.http.HttpServletRequest;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;

import okhttp3.HttpUrl;

@Service
public class SandboxIngressRequestContextResolver {

    private static final Logger log = LoggerFactory.getLogger(SandboxIngressRequestContextResolver.class);

    private final SandboxIngressEndpointResolver endpointResolver;
    private final SandboxIngressUserResolver userResolver;
    private final SandboxIngressRuntimeResolver runtimeResolver;

    public SandboxIngressRequestContextResolver(SandboxIngressEndpointResolver endpointResolver,
                                                SandboxIngressUserResolver userResolver,
                                                SandboxIngressRuntimeResolver runtimeResolver) {
        this.endpointResolver = endpointResolver;
        this.userResolver = userResolver;
        this.runtimeResolver = runtimeResolver;
    }

    public SandboxIngressRequestContext resolve(HttpServletRequest request,
                                                String instance,
                                                String requestPath) {
        SandboxIngressInstanceType instanceType = SandboxIngressInstanceType.from(instance);
        String queryString = request.getQueryString();
        String beyondToken = resolveBeyondToken(request);
        log.debug("Resolving ingress context: instance={}, requestPath={}, query={}, beyondToken={}",
            instance, requestPath, queryString, maskToken(beyondToken));
        SandboxIngressUserContext userContext = userResolver.resolve(beyondToken);
        String userCode = resolveUserCode(userContext);
        log.debug("Ingress user resolved: instance={}, userCode={}, loginInfoPresent={}",
            instance, userCode, userContext != null && userContext.loginInfo() != null);
        String upstreamEndpoint = endpointResolver.resolveRequiredEndpoint(userCode, instance);
        HttpUrl targetUrl = runtimeResolver.resolve().buildTargetUrl(upstreamEndpoint, requestPath, queryString);
        log.debug("Ingress target resolved: instance={}, userCode={}, upstreamEndpoint={}, targetUrl={}",
            instance, userCode, upstreamEndpoint, targetUrl);
        Map<String, String> extraHeaders = new LinkedHashMap<>(2);
        if (StringUtils.isBlank(request.getHeader("Beyond-Token")) && StringUtils.isNotBlank(userContext.beyondToken())) {
            extraHeaders.put("Beyond-Token", userContext.beyondToken());
            log.debug("Injecting Beyond-Token header for ingress request: instance={}, userCode={}, token={}",
                instance, userCode, maskToken(userContext.beyondToken()));
        }
        return new SandboxIngressRequestContext(instanceType, instance, userCode, upstreamEndpoint, request.getMethod(),
            requestPath, queryString, targetUrl, userContext.beyondToken(), userContext.loginInfo(), extraHeaders);
    }

    private String resolveBeyondToken(HttpServletRequest request) {
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

    private String resolveUserCode(SandboxIngressUserContext userContext) {
        if (userContext != null && userContext.loginInfo() != null && StringUtils.isNotBlank(userContext.loginInfo().getUserCode())) {
            return userContext.loginInfo().getUserCode();
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
