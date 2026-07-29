package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Registers {@link WecomStreamProperties} as a bean so {@code channel.stream.*}
 * config is bound and injectable (mirror of the DingTalk stream configuration).
 */
@Configuration
@EnableConfigurationProperties(WecomStreamProperties.class)
public class WecomStreamConfiguration {
}
