package com.iwhalecloud.byai.gateway.sandbox.model.opendesign;

public class OpenDesignRedirectResult {

    private final String targetUrl;

    public OpenDesignRedirectResult(String targetUrl) {
        this.targetUrl = targetUrl;
    }

    public String getTargetUrl() {
        return targetUrl;
    }
}
