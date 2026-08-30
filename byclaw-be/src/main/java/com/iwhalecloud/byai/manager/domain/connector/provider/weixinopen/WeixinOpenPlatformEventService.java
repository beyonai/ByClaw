package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

import java.time.Instant;

import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class WeixinOpenPlatformEventService {
    private static final long MAX_TIMESTAMP_SKEW_SECONDS = 300L;

    private final WeixinOpenPlatformConfigResolver configResolver;
    private final WeixinOpenPlatformCrypto crypto;
    private final WeixinComponentTicketStore ticketStore;
    private final WeixinAuthorizerAuthStore authStore;
    private final WeixinOpenPlatformXml xml;

    public WeixinOpenPlatformEventService(
            WeixinOpenPlatformConfigResolver configResolver,
            WeixinOpenPlatformCrypto crypto,
            WeixinComponentTicketStore ticketStore,
            WeixinAuthorizerAuthStore authStore) {
        this(configResolver, crypto, ticketStore, authStore, new WeixinOpenPlatformXml());
    }

    WeixinOpenPlatformEventService(
            WeixinOpenPlatformConfigResolver configResolver,
            WeixinOpenPlatformCrypto crypto,
            WeixinComponentTicketStore ticketStore,
            WeixinAuthorizerAuthStore authStore,
            WeixinOpenPlatformXml xml) {
        this.configResolver = configResolver;
        this.crypto = crypto;
        this.ticketStore = ticketStore;
        this.authStore = authStore;
        this.xml = xml;
    }

    public String handle(String signature, String timestamp, String nonce, String requestBody) {
        long requestTime;
        try {
            requestTime = Long.parseLong(timestamp);
        } catch (RuntimeException e) {
            throw invalid();
        }
        if (Math.abs(Instant.now().getEpochSecond() - requestTime) > MAX_TIMESTAMP_SKEW_SECONDS
                || !StringUtils.hasText(signature) || !StringUtils.hasText(nonce)) {
            throw invalid();
        }
        WeixinOpenPlatformConfig config = configResolver.resolveDefault();
        String encrypted = xml.encrypted(requestBody);
        String decrypted = crypto.verifyAndDecrypt(
            config.callbackToken(), config.encodingAesKey(), config.componentAppid(),
            signature, timestamp, nonce, encrypted);
        WeixinOpenPlatformXml.Event event = xml.event(decrypted);
        if (!config.componentAppid().equals(event.componentAppid())) {
            throw invalid();
        }
        switch (event.infoType()) {
            case "component_verify_ticket" -> ticketStore.saveIfNewer(
                config.componentAppid(), required(event.componentVerifyTicket()), event.createTime());
            case "unauthorized" -> authStore.revokeByAuthorizer(required(event.authorizerAppid()));
            default -> {
                // Authenticated events that do not mutate this connector are acknowledged idempotently.
            }
        }
        return "success";
    }

    private String required(String value) {
        if (!StringUtils.hasText(value)) {
            throw invalid();
        }
        return value;
    }

    private IllegalArgumentException invalid() {
        return new IllegalArgumentException("Weixin Open Platform callback is invalid");
    }
}
