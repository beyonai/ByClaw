package com.iwhalecloud.byai.common.hook;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.EnumerablePropertySource;
import org.springframework.core.env.PropertySource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.embedded.EmbeddedDatabase;
import org.springframework.jdbc.datasource.embedded.EmbeddedDatabaseBuilder;
import org.springframework.jdbc.datasource.embedded.EmbeddedDatabaseType;
import org.yaml.snakeyaml.Yaml;

/** 将投递回归测试的配置夹具写入独立数据库；生产加载器只读取数据库文档。 */
@TestConfiguration(proxyBeanMethods = false)
public class HookDatabaseTestSupport {
    @Bean(destroyMethod = "shutdown")
    EmbeddedDatabase hookTestDatabase(ConfigurableEnvironment environment) {
        EmbeddedDatabase database = new EmbeddedDatabaseBuilder().generateUniqueName(true)
            .setType(EmbeddedDatabaseType.H2).build();
        JdbcTemplate jdbc = new JdbcTemplate(database);
        jdbc.execute("CREATE SCHEMA byai");
        jdbc.execute("CREATE TABLE byai.byai_system_config(param_code varchar(255),param_value text)");
        Map<String, Object> properties = new LinkedHashMap<>();
        List<PropertySource<?>> sources = new ArrayList<>();
        environment.getPropertySources().forEach(sources::add);
        Collections.reverse(sources);
        for (PropertySource<?> source : sources) {
            if (source instanceof EnumerablePropertySource<?> enumerable) {
                for (String name : enumerable.getPropertyNames()) {
                    if (name.startsWith("byclaw.hooks.")) {
                        properties.put(name, source.getProperty(name));
                    }
                }
            }
        }
        if (!properties.isEmpty()) {
            jdbc.update("INSERT INTO byai.byai_system_config(param_code,param_value) VALUES (?,?)",
                "BYCLAW_HOOKS_CONFIG", new Yaml().dump(properties));
        }
        return database;
    }

    @Bean
    JdbcTemplate hookTestJdbcTemplate(EmbeddedDatabase hookTestDatabase) {
        return new JdbcTemplate(hookTestDatabase);
    }
}
