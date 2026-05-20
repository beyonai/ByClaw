package com.iwhalecloud.byai.gateway.sandbox.spec;

import java.util.Locale;

import org.apache.commons.lang3.StringUtils;

public final class SandboxImageType {

    public static final String OPENCLAW = "openclaw";
    public static final String UI_AGENT = "uiagent";

    private SandboxImageType() {
    }

    public static String normalize(String imageType) {
        return StringUtils.trimToEmpty(imageType).toLowerCase(Locale.ROOT);
    }

    public static boolean isOpenclaw(String imageType) {
        return OPENCLAW.equals(normalize(imageType));
    }

    public static boolean isUiAgent(String imageType) {
        return UI_AGENT.equals(normalize(imageType));
    }
}
