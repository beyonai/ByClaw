package com.iwhalecloud.byai.gateway.sandbox.platform;

import feign.*;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.context.annotation.Bean;
import org.springframework.web.bind.annotation.*;

/** BE 内定义专用 Feign；远程超时和非成功响应禁止本地补做。 */
@ConditionalOnProperty(name = "byclaw.platform.execution-mode", havingValue = "remote")
@FeignClient(
        name = "byclaw-platform-alerts",
        url = "${byclaw.platform.base-url:}",
        configuration = PlatformAlertClient.Configuration.class)
public interface PlatformAlertClient {
    @PostMapping("/internal/platform/sandbox/autoscale/alerts")
    Map<String, Object> receive(@RequestBody Map<String, Object> payload);
    // 不加全局 Configuration 注解，避免专用拦截器污染其他 Feign 客户端。
    class Configuration {
        @Bean
        public org.springframework.cloud.openfeign.clientconfig.FeignClientConfigurer
                platformAlertIsolation() {
            return new org.springframework.cloud.openfeign.clientconfig.FeignClientConfigurer() {
                @Override
                public boolean inheritParentConfiguration() {
                    return false;
                }
            };
        }

        @Bean
        public Client platformAlertTransport() {
            return new feign.okhttp.OkHttpClient(
                    new okhttp3.OkHttpClient.Builder()
                            .retryOnConnectionFailure(false)
                            .followRedirects(false)
                            .followSslRedirects(false)
                            .build());
        }

        @Bean
        public Retryer platformAlertRetryer() {
            return Retryer.NEVER_RETRY;
        }

        @Bean
        public Request.Options platformAlertOptions() {
            return new Request.Options(5000, 130000, false);
        }

        @Bean
        public RequestInterceptor platformAlertJwt(PlatformBridgeTokens tokens) {
            return request -> {
                request.removeHeader("beyond-token");
                request.header("beyond-token", tokens.createToken());
            };
        }

        @Bean
        public Logger.Level platformAlertLogLevel() {
            return Logger.Level.NONE;
        }
    }
}
