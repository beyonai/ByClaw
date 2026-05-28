package com.iwhalecloud.byai.gateway.sandbox.model.opendesign;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public class OpenDesignRequestEnvironment {

    private String daemonBaseUrl;
    private String redirectRoutePrefix;
    private String agentId;
    private String defaultSkillId;
    private String defaultDesignSystemId;
    private Map<String, String> headers = Collections.emptyMap();

    public String getDaemonBaseUrl() {
        return daemonBaseUrl;
    }

    public void setDaemonBaseUrl(String daemonBaseUrl) {
        this.daemonBaseUrl = daemonBaseUrl;
    }

    public String getRedirectRoutePrefix() {
        return redirectRoutePrefix;
    }

    public void setRedirectRoutePrefix(String redirectRoutePrefix) {
        this.redirectRoutePrefix = redirectRoutePrefix;
    }

    public String getAgentId() {
        return agentId;
    }

    public void setAgentId(String agentId) {
        this.agentId = agentId;
    }

    public String getDefaultSkillId() {
        return defaultSkillId;
    }

    public void setDefaultSkillId(String defaultSkillId) {
        this.defaultSkillId = defaultSkillId;
    }

    public String getDefaultDesignSystemId() {
        return defaultDesignSystemId;
    }

    public void setDefaultDesignSystemId(String defaultDesignSystemId) {
        this.defaultDesignSystemId = defaultDesignSystemId;
    }

    public Map<String, String> getHeaders() {
        return headers;
    }

    public void setHeaders(Map<String, String> headers) {
        if (headers == null || headers.isEmpty()) {
            this.headers = Collections.emptyMap();
            return;
        }
        this.headers = Collections.unmodifiableMap(new LinkedHashMap<>(headers));
    }
}
