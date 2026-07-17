package com.iwhalecloud.byai.state.domain.recorder.model;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Objects;

public final class RecorderSession {

    private final String sessionId;
    private final RecorderOwner owner;
    private final long createdAt;
    private String contextId = "default";
    private String targetId;
    private RecorderSessionState state = RecorderSessionState.IDLE;
    private int stateVersion = 1;
    private long updatedAt;
    private boolean awaitingLogin;
    private String currentUrl;
    private String recordingMode = "tab_projection";
    private String vncProvider;
    private String vncUrl;
    private String vncContainerName;
    private Integer vncPort;
    private String gatewayHost;
    private Integer gatewayPort;
    private List<Map<String, Object>> candidates = List.of();
    private volatile List<Map<String, Object>> drafts = List.of();
    private final Map<String, List<Map<String, Object>>> samples = new ConcurrentHashMap<>();

    public RecorderSession(String sessionId, RecorderOwner owner) {
        this.sessionId = sessionId;
        this.owner = Objects.requireNonNull(owner, "owner");
        this.createdAt = Instant.now().toEpochMilli();
        this.updatedAt = this.createdAt;
    }

    public String sessionId() {
        return sessionId;
    }

    public RecorderOwner owner() {
        return owner;
    }

    public long createdAt() {
        return createdAt;
    }

    public long updatedAt() {
        return updatedAt;
    }

    public String contextId() {
        return contextId;
    }

    public void contextId(String contextId) {
        this.contextId = contextId;
        touch();
    }

    public String targetId() {
        return targetId;
    }

    public void targetId(String targetId) {
        this.targetId = targetId;
        touch();
    }

    public RecorderSessionState state() {
        return state;
    }

    public void state(RecorderSessionState state) {
        this.state = state;
        this.stateVersion++;
        touch();
    }

    public int stateVersion() {
        return stateVersion;
    }

    public boolean awaitingLogin() {
        return awaitingLogin;
    }

    public void awaitingLogin(boolean awaitingLogin) {
        this.awaitingLogin = awaitingLogin;
        touch();
    }

    public String currentUrl() {
        return currentUrl;
    }

    public void currentUrl(String currentUrl) {
        this.currentUrl = currentUrl;
        touch();
    }

    public String recordingMode() {
        return recordingMode;
    }

    public void recordingMode(String recordingMode) {
        this.recordingMode = recordingMode;
        touch();
    }

    public boolean isVnc() {
        return "vnc".equals(recordingMode);
    }

    public String vncProvider() {
        return vncProvider;
    }

    public void vncProvider(String vncProvider) {
        this.vncProvider = vncProvider;
        touch();
    }

    public String vncUrl() {
        return vncUrl;
    }

    public void vncUrl(String vncUrl) {
        this.vncUrl = vncUrl;
        touch();
    }

    public String vncContainerName() {
        return vncContainerName;
    }

    public void vncContainerName(String vncContainerName) {
        this.vncContainerName = vncContainerName;
        touch();
    }

    public Integer vncPort() {
        return vncPort;
    }

    public void vncPort(Integer vncPort) {
        this.vncPort = vncPort;
        touch();
    }

    public String gatewayHost() {
        return gatewayHost;
    }

    public void gatewayHost(String gatewayHost) {
        this.gatewayHost = gatewayHost;
        touch();
    }

    public Integer gatewayPort() {
        return gatewayPort;
    }

    public void gatewayPort(Integer gatewayPort) {
        this.gatewayPort = gatewayPort;
        touch();
    }

    public List<Map<String, Object>> candidates() {
        return candidates;
    }

    public void candidates(List<Map<String, Object>> candidates) {
        this.candidates = candidates;
        touch();
    }

    public List<Map<String, Object>> drafts() {
        return drafts;
    }

    public void drafts(List<Map<String, Object>> drafts) {
        this.drafts = drafts;
        touch();
    }

    public Map<String, List<Map<String, Object>>> samples() {
        return samples;
    }

    private void touch() {
        updatedAt = Instant.now().toEpochMilli();
    }
}
