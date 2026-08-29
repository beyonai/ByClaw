package com.iwhalecloud.byai.manager.domain.connector.provider.weixin;

/** Performs the minimum Weixin Official Account API probe without exposing the returned token. */
public interface WeixinOfficialApiClient {

    Status verify(String appId, String appSecret);

    enum Status {
        VALID,
        INVALID_CREDENTIALS,
        IP_NOT_ALLOWLISTED,
        TIMEOUT,
        FAILED,
        PROTOCOL_ERROR
    }
}
