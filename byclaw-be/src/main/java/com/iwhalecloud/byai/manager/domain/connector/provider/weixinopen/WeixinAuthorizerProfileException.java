package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

public class WeixinAuthorizerProfileException extends RuntimeException {
    private final boolean timeout;

    public WeixinAuthorizerProfileException(boolean timeout) {
        super(timeout ? "Weixin authorizer profile lookup timed out" : "Weixin authorizer profile lookup failed");
        this.timeout = timeout;
    }

    public boolean isTimeout() {
        return timeout;
    }
}
