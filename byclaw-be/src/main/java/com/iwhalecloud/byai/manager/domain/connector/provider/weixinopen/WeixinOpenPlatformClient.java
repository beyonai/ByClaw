package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

import java.util.Date;

public interface WeixinOpenPlatformClient {
    String componentToken(String componentAppid, String componentAppsecret, String componentVerifyTicket);

    String createPreAuthCode(String componentAccessToken, String componentAppid);

    AuthorizerToken queryAuthorization(String componentAccessToken, String componentAppid, String authorizationCode);

    AuthorizerToken refreshAuthorizerToken(
        String componentAccessToken, String componentAppid, String authorizerAppid, String refreshToken);

    AuthorizerProfile getAuthorizerInfo(
        String componentAccessToken, String componentAppid, String authorizerAppid);

    record AuthorizerToken(
        String authorizerAppid,
        String accessToken,
        String refreshToken,
        String grantedScopes,
        Date accessExpiresAt
    ) {
    }

    record AuthorizerProfile(String appid, String nickname, String username, String principalName) {
    }
}
