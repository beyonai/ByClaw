package com.iwhalecloud.byai.common.config;

import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * @author he.duming
 * @date 2025-09-02 20:14:29
 * @description TODO
 */
@Configuration
public class FileUploadConfig {

    @Bean
    public TomcatServletWebServerFactory embeddedServletContainerFactory() {
        TomcatServletWebServerFactory tomcatEmbeddedServletContainerFactory = new TomcatServletWebServerFactory();
        tomcatEmbeddedServletContainerFactory.addConnectorCustomizers(connector -> {
            connector.setMaxPartCount(5000);
        });
        return tomcatEmbeddedServletContainerFactory;
    }
}
