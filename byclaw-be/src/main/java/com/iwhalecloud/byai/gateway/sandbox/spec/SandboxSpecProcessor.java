package com.iwhalecloud.byai.gateway.sandbox.spec;

import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;

import java.util.Map;

public interface SandboxSpecProcessor {

    CreateSandboxRequest buildCreateRequest(String userCode,
                                              String serviceKey,
                                              Map<String, String> envVars,
                                              Map<String, Object> userInfo,
                                              SandboxServiceSpec spec);
}

