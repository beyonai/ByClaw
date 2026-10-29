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
            long startupTimeout = env.getProperty("byclaw.gateway.worker-readiness-timeout-ms", Long.class,
                    env.getProperty("BYCLAW_SANDBOX_STARTUP_TIMEOUT_MS", Long.class, 60000L));
            // Keep transport headroom when operators extend the startup budget.
            int defaultReadTimeout = (int) Math.max(130000L,
                    Math.min(Integer.MAX_VALUE - 10000L, startupTimeout) + 10000L);
            return new Request.Options(
                    env.getProperty("byclaw.platform.connect-timeout-ms", Integer.class, 5000),
                    env.getProperty("byclaw.platform.read-timeout-ms", Integer.class, defaultReadTimeout),
                    false);
        }
    }
}
