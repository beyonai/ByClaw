package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.List;

import com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest;
import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;

/**
 * Internal sandbox lifecycle facade.
 *
 * <p>External business code must go through {@link SandboxService}. Runtime selection,
 * lifecycle orchestration and provider adaptation stay inside the sandbox package.</p>
 */
public interface SandboxLifecycleFacade {

    SandboxResponse<SandboxLaunchData> launchSandbox(SandboxLaunchRequest request);

    SandboxResponse<Void> removeSandbox(SandboxLaunchRequest request);

    SandboxResponse<Void> heartbeat(String userCode);

    SandboxResponse<List<SandboxInfo>> sandboxInfo(String userCode);

    SandboxResponse<SandboxInfo> sandboxInfo(String userCode, String sandboxType);
}
