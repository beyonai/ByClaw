package com.iwhalecloud.byai.gateway.sandbox.shared;

import java.util.HashSet;
import java.util.Set;

import lombok.Getter;
import lombok.Setter;

/**
 * JSON configuration object for the shared sandbox policy.
 */
@Getter
@Setter
public class SharedSandboxPolicyConfig {
    /**
     * 共享模式
     */
    public static final String SHARED = "shared";
    /**
     * 专用独享模式
     */
    public static final String EXCLUSIVE = "exclusive";

    private String defaultMode;

    private Set<String> excludedUsers = new HashSet<>();
}
