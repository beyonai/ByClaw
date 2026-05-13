package com.iwhalecloud.byai;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Properties;

import org.mybatis.spring.annotation.MapperScan;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.server.ErrorPage;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.boot.web.servlet.server.ConfigurableServletWebServerFactory;
import org.springframework.boot.web.servlet.support.SpringBootServletInitializer;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.EnableAspectJAutoProxy;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.session.data.redis.config.annotation.web.http.EnableRedisHttpSession;
import org.springframework.transaction.annotation.EnableTransactionManagement;


@EnableTransactionManagement
@EnableAsync
@EnableScheduling
@EnableDiscoveryClient
@EnableFeignClients(basePackages = "com.iwhalecloud")
@MapperScan(basePackages = {"com.iwhalecloud.byai.manager.mapper","com.iwhalecloud.byai.gateway.sandbox.mapper"})
@EnableAspectJAutoProxy
@EnableWebSecurity
@EnableRedisHttpSession(redisNamespace = "${spring.session.redis.namespace:common_system}")
@EnableMethodSecurity
@SpringBootApplication(scanBasePackages = {
        "com.iwhalecloud"
})
public class ByaiServerApplication extends SpringBootServletInitializer {

    private static final Logger logger = LoggerFactory.getLogger(ByaiServerApplication.class);

    public static void main(String[] args) {
        loadEnvFile();
        logger.info("============ ByaiServerApplication main ============");
        SpringApplicationBuilder springApplicationBuilder = new SpringApplicationBuilder(
                ByaiServerApplication.class);
        String configPath = resolveConfigPath(args);
        if (configPath != null) {
            Properties properties = loadPropertiesConfig(configPath);
            if (properties != null) {
                normalizeLoggingConfigForOs(properties, configPath);
                springApplicationBuilder.properties(properties);
            }
        }
        SpringApplication springApplication = springApplicationBuilder.application();
        springApplication.setAllowBeanDefinitionOverriding(true);
        springApplication.setAllowCircularReferences(true);
        springApplication.run(args);
    }

    /**
     * 加载 .env 文件中的变量到系统属性，供 ${VAR} 占位符解析
     */
    private static void loadEnvFile() {
        Path envPath = resolveEnvFilePath();
        if (envPath == null) {
            return;
        }
        try (BufferedReader reader = Files.newBufferedReader(envPath)) {
            logger.info("Loading env file from: {}", envPath.toAbsolutePath());
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#")) {
                    continue;
                }
                int idx = line.indexOf('=');
                if (idx > 0) {
                    String key = line.substring(0, idx).trim();
                    String value = line.substring(idx + 1).trim();
                    if (System.getProperty(key) == null && System.getenv(key) == null) {
                        System.setProperty(key, value);
                    }
                }
            }
        } catch (Exception e) {
            logger.error("Failed to load .env file: " + e.getMessage(), e);
        }
    }

    /**
     * 查找 .env 文件路径：
     * 1) 优先读取 JVM 参数 -Denv.file=/path/to/.env
     * 2) 否则从当前工作目录逐级向上查找第一个 .env
     */
    private static Path resolveEnvFilePath() {
        String explicitEnvPath = System.getProperty("env.file");
        if (explicitEnvPath != null && !explicitEnvPath.trim().isEmpty()) {
            Path path = Paths.get(explicitEnvPath).toAbsolutePath().normalize();
            if (Files.exists(path) && Files.isRegularFile(path)) {
                return path;
            }
            logger.warn("env.file is set but file does not exist: {}", path);
        }

        Path current = Paths.get("").toAbsolutePath().normalize();
        while (current != null) {
            Path candidate = current.resolve(".env");
            if (Files.exists(candidate) && Files.isRegularFile(candidate)) {
                return candidate;
            }
            current = current.getParent();
        }
        return null;
    }

    /**
     * Spring 会把 {@code logging.config} 解析成绝对路径字符串；在 Windows 上若该字符串来自 MSYS 形态
     * （如 {@code /d/...}），会变成 {@code D:\\d\\...} 导致 Logback 找不到文件。
     * <p>
     * 另外 {@code mvn spring-boot:run} 时 {@code user.dir} 是 {@code .../byclaw-be}，
     * 与 {@code config/logback.xml} 的相对路径一致，无需特殊处理。
     * 本项目的约定是：{@code logging.config=config/logback.xml} 相对 byclaw-be 根目录（与
     * {@code config/application.properties} 的父目录的父目录一致）。
     */
    private static void normalizeLoggingConfigForOs(Properties properties, String configPath) {
        String raw = properties.getProperty("logging.config");
        if (raw == null || raw.isBlank()) {
            return;
        }
        String v = raw.trim();
        if (v.startsWith("classpath:") || v.startsWith("classpath*:")) {
            return;
        }
        if (v.regionMatches(true, 0, "file:", 0, 5)) {
            return;
        }
        Path base = resolveLoggingConfigBaseDir(configPath);
        if (base == null) {
            base = Paths.get(System.getProperty("user.dir", ".")).toAbsolutePath().normalize();
        }
        Path resolved = base.resolve(v).normalize();
        if (Files.isRegularFile(resolved)) {
            String uri = resolved.toUri().toString();
            properties.setProperty("logging.config", uri);
            logger.info("logging.config normalized to {}", uri);
        }
    }

    /**
     * byclaw-be 根目录：{@code .../config/application.properties} → 其父的父目录（{@code .../byclaw-be}）。
     */
    private static Path resolveLoggingConfigBaseDir(String configPath) {
        if (configPath == null || configPath.isBlank()) {
            return null;
        }
        String p = configPath.trim();
        String fileName = p.endsWith(".properties") ? p : p + ".properties";
        Path applicationProps = Paths.get(fileName).toAbsolutePath().normalize();
        Path configDir = applicationProps.getParent();
        if (configDir == null) {
            return null;
        }
        return configDir.getParent();
    }

    /**
     * 加载配置文件
     *
     * @param configPath 配置文件路径
     * @return Properties
     */
    private static Properties loadPropertiesConfig(String configPath) {

        if (configPath == null || "".equals(configPath)) {
            return null;
        }
        logger.info("loadPropertiesConfig is {}", configPath);

        Properties properties = new Properties();
        String[] files = configPath.split(",");
        for (String file : files) {
            Properties propertiesLoad = new Properties();

            // 判断文件是否为properties结尾，若不是，则添加properties
            String fileName = file.endsWith(".properties") ? file : file + ".properties";
            File configFile = new File(fileName);

            try (FileInputStream fileInputStream = new FileInputStream(configFile);) {

                propertiesLoad.load(fileInputStream);
                for (String key : propertiesLoad.stringPropertyNames()) {
                    if (propertiesLoad.get(key) == null) {
                        properties.setProperty(key, "");
                    }
                    else {
                        properties.setProperty(key, propertiesLoad.get(key).toString());
                    }
                }
            }
            catch (Exception e) {
                logger.error(e.getMessage(), e);
            }
        }
        return properties;
    }

    /**
     * Resolve external properties config path.
     * Priority:
     * 1) first non-option app arg (e.g. "config/application")
     * 2) fallback to nearest existing "config/application.properties" from cwd upward
     */
    private static String resolveConfigPath(String[] args) {
        if (args != null && args.length > 0 && args[0] != null) {
            String firstArg = args[0].trim();
            // Spring-style options like --spring.profiles.active=local should not be treated as file path.
            if (!firstArg.isEmpty() && !firstArg.startsWith("--")) {
                Path explicit = Paths.get(firstArg).toAbsolutePath().normalize();
                Path explicitWithExt = explicit;
                if (!explicit.toString().endsWith(".properties")) {
                    explicitWithExt = Paths.get(explicit.toString() + ".properties");
                }
                if (Files.exists(explicitWithExt) && Files.isRegularFile(explicitWithExt)) {
                    return firstArg;
                }
                logger.warn("Explicit config path does not exist: {}. Falling back to auto-discovery.", explicitWithExt);
            }
        }

        Path current = Paths.get("").toAbsolutePath().normalize();
        while (current != null) {
            Path candidate = current.resolve("config").resolve("application.properties");
            if (Files.exists(candidate) && Files.isRegularFile(candidate)) {
                return candidate.toString();
            }
            current = current.getParent();
        }
        return null;
    }

    @Override
    protected SpringApplicationBuilder configure(SpringApplicationBuilder application) {
        logger.debug("ConversationServerApplication configure");
        return application.sources(ByaiServerApplication.class);
    }

    @Bean
    public WebServerFactoryCustomizer<ConfigurableServletWebServerFactory> webServerFactoryCustomizer() {
        return factory -> {
            ErrorPage error401Page = new ErrorPage(HttpStatus.UNAUTHORIZED, "/error.jsp");
            ErrorPage error404Page = new ErrorPage(HttpStatus.NOT_FOUND, "/error.jsp");
            ErrorPage error500Page = new ErrorPage(HttpStatus.INTERNAL_SERVER_ERROR, "/error.jsp");
            factory.addErrorPages(error401Page, error404Page, error500Page);
        };
    }

}
