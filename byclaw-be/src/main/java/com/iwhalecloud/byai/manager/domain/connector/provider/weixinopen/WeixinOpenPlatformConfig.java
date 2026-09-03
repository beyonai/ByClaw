package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

public record WeixinOpenPlatformConfig(
    String componentAppid,
    String componentAppsecret,
    String callbackToken,
    String encodingAesKey,
    String redirectUri
) {
}
