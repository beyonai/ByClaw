package com.iwhalecloud.byai.gateway.sandbox.service;

import com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest;
import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInstance;

/**
 * Internal sandbox lifecycle facade.
 *
 * <p>External business code must go through {@link SandboxService}. Runtime selection,
 * lifecycle orchestration and provider adaptation stay inside the sandbox package.</p>
 */
public interface SandboxLifecycleFacade {

    SandboxResponse<SandboxLaunchData> launchSandbox(SandboxLaunchRequest request);

    SandboxResponse<Void> removeSandbox(SandboxInfo sandboxInfo);

    SandboxResponse<Void> renewSandbox(SandboxInfo sandboxInfo);

    SandboxResponse<SandboxRuntimeInstance> getSandbox(SandboxInfo sandboxInfo);

    SandboxResponse<Boolean> sandboxExists(SandboxInfo sandboxInfo);
}
