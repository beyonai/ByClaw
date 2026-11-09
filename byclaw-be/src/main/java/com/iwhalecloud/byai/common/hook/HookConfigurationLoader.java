package com.iwhalecloud.byai.common.hook;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.boot.context.properties.bind.BindHandler;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.bind.handler.NoUnboundElementsBindHandler;
import org.springframework.boot.context.properties.source.ConfigurationPropertySources;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.env.PropertySourcesPropertyResolver;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

/** 从平台配置表读取一份启动配置，独立绑定 JSON/YAML，避免外部属性覆盖数据库订阅。 */
final class HookConfigurationLoader {
    static final String CONFIG_CODE = "BYCLAW_HOOKS_CONFIG";
    private static final String PREFIX = "byclaw.hooks";

    private HookConfigurationLoader() { }

    /**
     * 直接读库一次；占位符可访问部署环境，配置项本身只取自数据库文档。
     * @param jdbc 平台数据库访问器
     * @param environment 用于解析环境变量和默认值的 Spring 环境
     * @return 尚未分配投递资源的启动配置
     */
    static HookProperties load(JdbcTemplate jdbc, ConfigurableEnvironment environment) {
        List<String> documents;
        try {
            documents = jdbc.queryForList(
                "SELECT param_value FROM byai.byai_system_config WHERE param_code = ?", String.class, CONFIG_CODE);
        } catch (DataAccessException unavailable) {
            // 驱动异常可能携带连接凭据；启动失败只暴露固定的配置标识。
            throw new IllegalStateException("Cannot read " + CONFIG_CODE + " from byai.byai_system_config");
        }
        if (documents.isEmpty()) {
            return new HookProperties();
        }
        if (documents.size() != 1) {
            throw new IllegalStateException("Expected exactly one " + CONFIG_CODE + " configuration row");
        }
        String yaml = documents.getFirst();
        if (yaml == null || yaml.isBlank()) {
            throw new IllegalStateException("Empty " + CONFIG_CODE + " YAML document");
        }
        try {
            LoaderOptions options = new LoaderOptions();
            options.setAllowDuplicateKeys(false);
            // 不使用会在 DEBUG 中输出完整文档的 Spring YAML 加载器。
            var documentsIterator = new Yaml(new SafeConstructor(options)).loadAll(yaml).iterator();
            if (!documentsIterator.hasNext()) {
                throw new IllegalArgumentException();
            }
            Object document = documentsIterator.next();
            if (!(document instanceof Map<?, ?>) || documentsIterator.hasNext()) {
                throw new IllegalArgumentException();
            }
            Map<String, Object> values = new LinkedHashMap<>();
            Set<String> nullLiterals = new LinkedHashSet<>();
            flatten("", document, values, nullLiterals);
            if (values.isEmpty() || values.keySet().stream().anyMatch(name -> !name.startsWith(PREFIX + "."))) {
                throw new IllegalArgumentException();
            }
            MutablePropertySources placeholders = new MutablePropertySources();
            MapPropertySource source = new MapPropertySource("database-hooks", values);
            placeholders.addLast(source);
            environment.getPropertySources().forEach(placeholders::addLast);
            PropertySourcesPropertyResolver resolver = new PropertySourcesPropertyResolver(placeholders);
            Binder binder = new Binder(ConfigurationPropertySources.from(source),
                value -> value instanceof String text ? resolver.resolveRequiredPlaceholders(text) : value);
            // 关闭时不绑定订阅，避免解析未设置的 URL、密钥或创建任何后台资源。
            if (!binder.bind(PREFIX + ".enabled", Boolean.class).orElse(false)) {
                return new HookProperties();
            }
            Set<String> subscriptionIds = new LinkedHashSet<>();
            String subscriptionsPrefix = PREFIX + ".subscriptions.";
            for (String name : values.keySet()) {
                if (name.startsWith(subscriptionsPrefix)) {
                    String remaining = name.substring(subscriptionsPrefix.length());
                    int separator = remaining.indexOf('.');
                    if (separator < 1) {
                        throw new IllegalArgumentException();
                    }
                    subscriptionIds.add(remaining.substring(0, separator));
                }
            }
            for (String id : subscriptionIds) {
                if (!id.matches("[a-zA-Z0-9_-]{1,64}")) {
                    throw new IllegalArgumentException();
                }
                String subscriptionPrefix = subscriptionsPrefix + id;
                if (!binder.bind(subscriptionPrefix + ".enabled", Boolean.class).orElse(true)) {
                    values.keySet().removeIf(name -> name.startsWith(subscriptionPrefix + "."));
                    values.put(subscriptionPrefix + ".enabled", false);
                }
            }
            // Object 常量是完整 JSON 值，不能展开成 Binder 的属性路径而丢失 null 或容器类型。
            values.replaceAll((name, value) -> isLiteral(name) ? resolveLiteral(value, resolver) : value);
            HookProperties properties = binder.bind(PREFIX, Bindable.of(HookProperties.class),
                new NoUnboundElementsBindHandler(BindHandler.DEFAULT)).get();
            properties.getSubscriptions().forEach((id, subscription) -> {
                String prefix = subscriptionsPrefix + id + ".http.";
                subscription.getHttp().getBody().forEach((name, field) ->
                    restoreNull(prefix + "body." + name + ".value", field, nullLiterals));
                subscription.getHttp().getAuth().getHeaders().forEach((name, field) ->
                    restoreNull(prefix + "auth.headers." + name + ".value", field, nullLiterals));
                var canonical = subscription.getHttp().getAuth().getCanonicalFields();
                for (int index = 0; index < canonical.size(); index++) {
                    restoreNull(prefix + "auth.canonical-fields[" + index + "].value", canonical.get(index), nullLiterals);
                }
            });
            return properties;
        } catch (RuntimeException invalid) {
            // YAML、绑定及占位符异常可能包含配置原文，不能传播为启动异常的 cause。
            throw new IllegalStateException("Invalid " + CONFIG_CODE + " YAML, fields or placeholders");
        }
    }

    /** 将结构字段转为 Spring 属性路径，Field.value 保留为原始 JSON 常量。 */
    private static void flatten(String path, Object value, Map<String, Object> values, Set<String> nullLiterals) {
        if (isLiteral(path)) {
            values.put(path, value == null ? "" : value);
            if (value == null) {
                nullLiterals.add(path);
            }
        } else if (value instanceof Map<?, ?> map) {
            map.forEach((key, item) -> {
                if (!(key instanceof String name)) {
                    throw new IllegalArgumentException();
                }
                flatten(path.isEmpty() ? name : path + "." + name, item, values, nullLiterals);
            });
        } else if (value instanceof List<?> list) {
            if (list.isEmpty()) {
                values.put(path, "");
            }
            for (int index = 0; index < list.size(); index++) {
                flatten(path + "[" + index + "]", list.get(index), values, nullLiterals);
            }
        } else {
            values.put(path, value == null ? "" : value);
        }
    }

    /** 常量内容不参与属性名展开，认证常量仍由现有校验器限制为字符串。 */
    private static boolean isLiteral(String path) {
        return path.startsWith(PREFIX + ".subscriptions.") && path.endsWith(".value")
            && (path.contains(".http.body.") || path.contains(".http.auth.headers.")
                || path.contains(".http.auth.canonical-fields["));
    }

    /** 容器常量的字符串也解析占位符，避免把未替换的部署参数发送给接收端。 */
    private static Object resolveLiteral(Object value, PropertySourcesPropertyResolver resolver) {
        if (value instanceof String text) {
            return resolver.resolveRequiredPlaceholders(text);
        }
        if (value instanceof List<?> list) {
            List<Object> resolved = new ArrayList<>();
            list.forEach(item -> resolved.add(resolveLiteral(item, resolver)));
            return resolved;
        }
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> resolved = new LinkedHashMap<>();
            map.forEach((key, item) -> {
                if (!(key instanceof String name)) {
                    throw new IllegalArgumentException();
                }
                resolved.put(name, resolveLiteral(item, resolver));
            });
            return resolved;
        }
        return value;
    }

    /** Binder 不区分缺少属性与 null；按原始节点恢复显式 null 的存在标记。 */
    private static void restoreNull(String path, HookProperties.Field field, Set<String> nullLiterals) {
        if (nullLiterals.contains(path)) {
            field.setValue(null);
        }
    }

}
