package com.iwhalecloud.byai.gateway.channels.service.feishu.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "channel.stream")
@Data
public class FeishuStreamProperties {

    private boolean enabled;

    private boolean showReasoning;
}
