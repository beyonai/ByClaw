package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import java.util.Map;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;

import okhttp3.HttpUrl;

public record SandboxIngressRequestContext(
    SandboxIngressInstanceType instanceType,
    String instance,
    String userCode,
    String upstreamEndpoint,
    String requestMethod,
    String requestPath,
    String queryString,
    HttpUrl targetUrl,
    String beyondToken,
    LoginInfo loginInfo,
    Map<String, String> extraHeaders
) {
}
