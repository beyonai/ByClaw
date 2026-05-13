package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "dingtalk.stream")
@Data
public class DingtalkStreamProperties {

    private boolean enabled;

}
