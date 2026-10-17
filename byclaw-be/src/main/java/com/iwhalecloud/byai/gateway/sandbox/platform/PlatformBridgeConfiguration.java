package com.iwhalecloud.byai.gateway.sandbox.platform;

import java.util.List;
import javax.sql.DataSource;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;

@Configuration
@ConditionalOnProperty(name="byclaw.platform.execution-mode", havingValue="remote")
public class PlatformBridgeConfiguration {
    @Bean
    public PlatformBridgeTokens platformBridgeTokens(DataSource source) {
        List<String> values =
                new JdbcTemplate(source)
                        .query(
                                "SELECT app_secret FROM po_source_system WHERE system_code = ?",
                                (rs, row) -> rs.getString(1),
                                "BYAI_PLATFORM");
        if (values.size() != 1)
            throw new IllegalStateException(
                    "Expected exactly one BYAI_PLATFORM source-system record");
        return new PlatformBridgeTokens(values.get(0), 24);
    }
}
