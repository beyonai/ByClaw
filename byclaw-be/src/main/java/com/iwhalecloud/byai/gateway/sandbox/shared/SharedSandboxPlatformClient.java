package com.iwhalecloud.byai.gateway.sandbox.shared;

import java.util.Map;
import javax.sql.DataSource;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformBridgeTokens;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformControlClient;

/** 共享池始终由平台执行，不依赖独占沙箱的 legacy/remote 开关。 */
@ConditionalOnProperty(name = "byclaw.platform.base-url")
@FeignClient(name = "byclaw-platform-shared", url = "${byclaw.platform.base-url:}",
    configuration = SharedSandboxPlatformClient.Configuration.class)
public interface SharedSandboxPlatformClient {
    @PostMapping("/internal/platform/sandbox/shared/{operation}")
    Map<String, Object> call(@PathVariable("operation") String operation, @RequestBody Map<String, Object> payload);

    class Configuration extends PlatformControlClient.Configuration {
        @Bean
        @ConditionalOnMissingBean(PlatformBridgeTokens.class)
        public PlatformBridgeTokens sharedPlatformTokens(DataSource source) {
            var secrets = new JdbcTemplate(source).query(
                "SELECT app_secret FROM po_source_system WHERE system_code = ?", (rs, row) -> rs.getString(1), "BYAI_PLATFORM");
            if (secrets.size() != 1) throw new IllegalStateException("Expected one BYAI_PLATFORM source-system record");
            return new PlatformBridgeTokens(secrets.get(0), 24);
        }
    }
}
