package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

public class WeixinOpenPlatformClientException extends RuntimeException {
    private final boolean timeout;

    public WeixinOpenPlatformClientException(String message) {
        this(message, false);
    }

    public WeixinOpenPlatformClientException(String message, boolean timeout) {
        super(message);
        this.timeout = timeout;
    }

    public boolean isTimeout() {
        return timeout;
    }
}
