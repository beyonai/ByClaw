package com.iwhalecloud.byai.manager.vo.ecosystem;

import java.util.Date;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 本机采集端状态视图。
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
@Data
public class EcosystemAgentStatusVo {

    /**
     * 本机采集端是否在线。
     */
    private Boolean connected;

    /**
     * 本机采集端名称，通常展示用户设备名。
     */
    private String agentName;

    /**
     * 底层采集运行时名称，例如 OpenCLI。
     */
    private String runtimeName;

    /**
     * 底层采集运行时版本。
     */
    private String runtimeVersion;

    /**
     * Browser Bridge 连接状态。
     */
    private String browserBridgeStatus;

    /**
     * 当前绑定的 Chrome Profile。
     */
    private String chromeProfile;

    /**
     * 最近一次心跳时间。
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date lastHeartbeatTime;

    /**
     * 各目标网站的登录态检测结果。
     */
    private List<SiteSessionVo> siteSessions;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SiteSessionVo {

        /**
         * 站点编码，例如 zhihu。
         */
        private String siteCode;

        /**
         * 站点展示名称。
         */
        private String siteName;

        /**
         * 登录态状态编码。
         */
        private String status;

        /**
         * 登录态状态展示名称。
         */
        private String statusName;
    }
}
