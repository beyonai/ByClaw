package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import lombok.Getter;
import lombok.Setter;

/**
 * 钉钉机器人渠道配置。
 */
@Getter
@Setter
public class DingtalkRobotChannelConfig {

    private Long resourceId;

    private String resourceName;

    private String channel;

    private String clientId;

    private String clientSecret;

    private String robotCode;

    private String appId;

    private String cardTemplateId;
}
