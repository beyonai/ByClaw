package com.iwhalecloud.byai.gateway.sandbox.spec;

import java.util.Optional;

public interface SandboxServiceSpecRepository {
    Optional<SandboxServiceSpec> findByServiceKey(String serviceKey);
}

