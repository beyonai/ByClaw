package com.iwhalecloud.byai.state.application.service.recorder;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "recorder.browser")
public class RecorderBrowserProperties {

    private String adapter = "bycli";
    private String daemonHost = "127.0.0.1";
    private int daemonPort = 19825;
    private int timeoutMs = 30000;
    private String vncProvider = "external";
    private String vncUrl;
    private String gatewayHost = "127.0.0.1";
    private Integer gatewayPort;
    private String podmanBin = "podman";
    private String vncImage = "bycli-verify:latest";
    private String vncContainer = "bycli-vnc";
    private int vncReadyTimeoutMs = 40000;
    private boolean vncRemoveOnStop;

    public String getAdapter() {
        return adapter;
    }

    public void setAdapter(String adapter) {
        this.adapter = adapter;
    }

    public String getDaemonHost() {
        return daemonHost;
    }

    public void setDaemonHost(String daemonHost) {
        this.daemonHost = daemonHost;
    }

    public int getDaemonPort() {
        return daemonPort;
    }

    public void setDaemonPort(int daemonPort) {
        this.daemonPort = daemonPort;
    }

    public int getTimeoutMs() {
        return timeoutMs;
    }

    public void setTimeoutMs(int timeoutMs) {
        this.timeoutMs = timeoutMs;
    }

    public String getVncProvider() {
        return vncProvider;
    }

    public void setVncProvider(String vncProvider) {
        this.vncProvider = vncProvider;
    }

    public String getVncUrl() {
        return vncUrl;
    }

    public void setVncUrl(String vncUrl) {
        this.vncUrl = vncUrl;
    }

    public String getGatewayHost() {
        return gatewayHost;
    }

    public void setGatewayHost(String gatewayHost) {
        this.gatewayHost = gatewayHost;
    }

    public Integer getGatewayPort() {
        return gatewayPort;
    }

    public void setGatewayPort(Integer gatewayPort) {
        this.gatewayPort = gatewayPort;
    }

    public String getPodmanBin() {
        return podmanBin;
    }

    public void setPodmanBin(String podmanBin) {
        this.podmanBin = podmanBin;
    }

    public String getVncImage() {
        return vncImage;
    }

    public void setVncImage(String vncImage) {
        this.vncImage = vncImage;
    }

    public String getVncContainer() {
        return vncContainer;
    }

    public void setVncContainer(String vncContainer) {
        this.vncContainer = vncContainer;
    }

    public int getVncReadyTimeoutMs() {
        return vncReadyTimeoutMs;
    }

    public void setVncReadyTimeoutMs(int vncReadyTimeoutMs) {
        this.vncReadyTimeoutMs = vncReadyTimeoutMs;
    }

    public boolean isVncRemoveOnStop() {
        return vncRemoveOnStop;
    }

    public void setVncRemoveOnStop(boolean vncRemoveOnStop) {
        this.vncRemoveOnStop = vncRemoveOnStop;
    }
}
