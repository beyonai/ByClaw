package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model;

import lombok.Getter;
import lombok.Setter;

/**
 * WeCom robot config resolved from a digital employee's {@code machineChannel}
 * JSON (channel discriminator "WeCom"). Mirrors
 * {@code DingtalkRobotChannelConfig} but the long connection only needs
 * {@code botId} + {@code secret}; {@code robotCode}/{@code clientSecret} are
 * accepted as normalized fallbacks (see plan §7.5).
 */
@Getter
@Setter
public class WecomRobotChannelConfig {

    private Long resourceId;
    private String resourceName;
    private String channel;

    /** Required. Normalized: botId if present, else robotCode. */
    private String botId;

    /** Required. Normalized: secret if present, else clientSecret. */
    private String secret;

    /** WeCom self-built app agent ID for contact API token cache scoping. */
    private String agentId;

    /** WeCom enterprise CorpID for contact API token lookup. */
    private String corpId;

    /** WeCom self-built app/contact secret for contact API token lookup. */
    private String corpSecret;
}
