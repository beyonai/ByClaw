package com.iwhalecloud.byai.gateway.sandbox.platform;

import feign.*;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.context.annotation.Bean;
import org.springframework.core.env.Environment;
import org.springframework.web.bind.annotation.*;

@ConditionalOnProperty(name = "byclaw.platform.execution-mode", havingValue = "remote")
@FeignClient(
        name = "byclaw-platform-control",
        url = "${byclaw.platform.base-url:}",
        configuration = PlatformControlClient.Configuration.class)
public interface PlatformControlClient {
    @PostMapping("/internal/platform/{area}/{operation}")
    Map<String, Object> call(
            @PathVariable("area") String area,
            @PathVariable("operation") String operation,
            @RequestBody Object payload);

    @GetMapping("/internal/platform/sandbox/autoscale/boundary-blacklist/metrics")
    String metrics();

    class Configuration extends PlatformAlertClient.Configuration {
        @Bean
        @org.springframework.context.annotation.Scope("prototype")
        public Feign.Builder platformControlBuilder() {
            return Feign.builder();
        }

        @org.springframework.beans.factory.annotation.Autowired private Environment env;

        @Bean
        @Override
        public Request.Options platformAlertOptions() {
            return new Request.Options(
                    env.getProperty("byclaw.platform.connect-timeout-ms", Integer.class, 5000),
                    env.getProperty("byclaw.platform.read-timeout-ms", Integer.class, 130000),
                    false);
        }
    }
}
