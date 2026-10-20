package com.iwhalecloud.byai.gateway.sandbox.platform;

import feign.*;
import feign.codec.Encoder;
import java.util.Map;
import org.springframework.beans.factory.ObjectFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.http.HttpMessageConverters;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.cloud.openfeign.support.SpringEncoder;
import org.springframework.context.annotation.Bean;
import org.springframework.web.bind.annotation.*;

@ConditionalOnProperty(name = "byclaw.platform.execution-mode", havingValue = "remote")
@FeignClient(
        name = "byclaw-platform-storage",
        url = "${byclaw.platform.base-url:}",
        configuration = PlatformStorageClient.Configuration.class)
public interface PlatformStorageClient {
    @GetMapping("/internal/platform/storage/content")
    Response get(@RequestParam Map<String, Object> query);

    @PutMapping("/internal/platform/storage/content")
    Map<String, Object> put(
            @RequestParam Map<String, Object> query,
            @RequestHeader("Content-Type") String contentType,
            @RequestBody Object placeholder);

    @PutMapping("/internal/platform/filesystem/content")
    Map<String,Object> copyReplace(@RequestParam Map<String,Object> query,
            @RequestHeader("Content-Type") String contentType,@RequestBody Object placeholder);

    class Configuration extends PlatformControlClient.Configuration {
        @Bean
        @Override
        public Client platformAlertTransport() {
            return new PlatformStreamingClient();
        }

        @Bean
        public Encoder platformStorageEncoder(ObjectFactory<HttpMessageConverters> converters) {
            Encoder json = new SpringEncoder(converters);
            return (object, type, template) -> {
                if (PlatformStreamingClient.upload() != null)
                    template.body(new byte[0], java.nio.charset.StandardCharsets.UTF_8);
                else json.encode(object, type, template);
            };
        }
    }
}
