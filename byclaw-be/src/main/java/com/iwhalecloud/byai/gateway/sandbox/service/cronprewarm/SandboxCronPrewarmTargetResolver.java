package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLaunchRouting;

@Service
public class SandboxCronPrewarmTargetResolver {

    private final SandboxCronPrewarmProperties properties;

    public SandboxCronPrewarmTargetResolver(SandboxCronPrewarmProperties properties) {
        this.properties = properties;
    }

    public SandboxCronPrewarmTarget resolve(String userCode, OpenClawCronDueJob job) {
        String serviceKey = StringUtils.defaultIfBlank(properties.getDefaultServiceKey(),
            SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE);
        return new SandboxCronPrewarmTarget(userCode, serviceKey,
            SandboxLaunchRouting.normalizeEffectiveResourceId(serviceKey, SandboxLaunchRouting.DEFAULT_RESOURCE_ID));
    }
}
