package com.iwhalecloud.byai.gateway.sandbox.platform;
/** 过渡告警入口固定匹配；不放宽其他内部接口。 */
public final class PlatformBridgePaths {
    private PlatformBridgePaths() {}

    public static boolean remoteAlert(String path, String mode) {
        return "remote".equals(mode) && "/sandbox/autoscale/alerts".equals(path);
    }

}
