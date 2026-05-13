package com.iwhalecloud.byai.manager.application.service.digitemploy.event;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 数字员工变更 Stream 配置与默认 Bean。
 */
@Configuration
@EnableConfigurationProperties(DigEmployeeChangeNotifyProperties.class)
public class DigEmployeeChangeConfiguration {

    @Bean
    @ConditionalOnMissingBean(DigEmployeeChangeLocalUserRegistry.class)
    public DigEmployeeChangeLocalUserRegistry digEmployeeChangeLocalUserRegistry() {
        return DigEmployeeChangeLocalUserRegistry.empty();
    }
}
