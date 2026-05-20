package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(DingtalkStreamProperties.class)
public class DingtalkStreamConfiguration {
}
