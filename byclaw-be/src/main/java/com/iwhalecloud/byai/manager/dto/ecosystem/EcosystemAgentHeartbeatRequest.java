package com.iwhalecloud.byai.manager.dto.ecosystem;

import java.util.List;

import lombok.Data;

/**
 * 本机采集端心跳请求。
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
@Data
public class EcosystemAgentHeartbeatRequest {

    /**
     * 本机采集端名称，通常是用户设备名。
     */
    private String agentName;

    /**
     * 采集运行时名称，例如 OpenCLI。
     */
    private String runtimeName;

    /**
     * 采集运行时版本号。
     */
    private String runtimeVersion;

    /**
     * Browser Bridge 连接状态。
     */
    private String browserBridgeStatus;

    /**
     * 本机 Chrome Profile 标识。
     */
    private String chromeProfile;

    /**
     * 采集端在线状态，例如 ONLINE、OFFLINE。
     */
    private String status;

    /**
     * 已检测到的网站登录态列表。
     */
    private List<SiteSessionRequest> siteSessions;

    @Data
    public static class SiteSessionRequest {

        /**
         * 站点编码，例如 zhihu、xiaohongshu。
         */
        private String siteCode;

        /**
         * 站点展示名称。
         */
        private String siteName;

        /**
         * 站点登录态状态，例如 LOGGED_IN、NEED_LOGIN。
         */
        private String status;

        /**
         * 站点登录态状态展示文案。
         */
        private String statusName;
    }
}
