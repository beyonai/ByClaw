package com.iwhalecloud.byai.state.common.redis;

import java.time.Duration;
import java.util.Arrays;
import java.util.HashSet;

import com.iwhalecloud.byai.common.ecrypt.RsaDecrypt;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.connection.RedisClusterConfiguration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.RedisPassword;
import org.springframework.data.redis.connection.RedisSentinelConfiguration;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.jedis.JedisClientConfiguration;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.data.redis.serializer.Jackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;
import org.springframework.data.redis.serializer.RedisSerializer;
import org.springframework.session.data.redis.RedisSessionRepository;
import org.springframework.session.data.redis.config.ConfigureRedisAction;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import io.lettuce.core.ClientOptions;
import io.lettuce.core.RedisURI;
import io.lettuce.core.SocketOptions;
import io.lettuce.core.cluster.ClusterClientOptions;

@ConditionalOnProperty(prefix = "spring.redis", value = "enabled", matchIfMissing = true)
@Configuration
public class RedisConfiguration {
    private static Logger logger = LoggerFactory.getLogger(RedisConfiguration.class);

    static final int DEFAULT_READ_TIMEOUT_MILLIS = 5000;

    @Autowired
    private RedisProperties redisProperties;

    // 连接超时配置
    @Value("${spring.redis.timeout:2000}")
    private int timeout;

    @Value("${spring.redis.read-timeout:" + DEFAULT_READ_TIMEOUT_MILLIS + "}")
    private int readTimeout;

    @Value("${spring.redis.ssl:false}")
    private boolean ssl;

    // Redis服务器配置
    @Value("${spring.redis.host:}")
    private String host;

    @Value("${spring.redis.port:}")
    private String port;

    @Value("${spring.redis.url:}")
    private String url;

    @Value("${spring.redis.database:0}")
    private String database;

    @Value("${spring.redis.password:}")
    private String password;

    @Value("${spring.redis.username:}")
    private String username;

    // 哨兵模式配置
    @Value("${spring.redis.sentinel.master:}")
    private String master;

    @Value("${spring.redis.sentinel.nodes:}")
    private String sentinels;

    // 集群模式配置
    @Value("${spring.redis.cluster.max-redirects:3}")
    private String maxRedirects;

    @Value("${spring.redis.cluster.nodes:}")
    private String clusters;

    @Value("${spring.redis.encrypt:false}")
    private boolean encrypt;

    @Value("${server.servlet.session.timeout:30m}")
    private Duration sessionTimeout;

    @Primary
    @Bean
    public RedisConnectionFactory connectionFactory() {
        CustomJedisPoolConfig poolConfig = new CustomJedisPoolConfig();

        // 使用RedisProperties配置连接池
        poolConfig.setPoolConfig(redisProperties);

        return createConnectionFactory(poolConfig);
    }

    /**
     * Dedicated Netty/Lettuce connection factory for Session Stream reads using the existing SDK keys.
     * Short, non-blocking XREADGROUP commands can share the native NIO connection, so the
     * number of locally-owned sessions no longer determines the Redis connection count.
     */
    @Bean("sessionStreamReactiveRedisConnectionFactory")
    public LettuceConnectionFactory sessionStreamReactiveRedisConnectionFactory() {
        LettuceClientConfiguration.LettuceClientConfigurationBuilder builder = LettuceClientConfiguration.builder()
            .commandTimeout(Duration.ofMillis(readTimeout))
            .shutdownTimeout(Duration.ofMillis(timeout));
        SocketOptions socketOptions = SocketOptions.builder().connectTimeout(Duration.ofMillis(timeout)).build();
        ClientOptions clientOptions = StringUtils.isNotBlank(clusters)
            ? ClusterClientOptions.builder().socketOptions(socketOptions).build()
            : ClientOptions.builder().socketOptions(socketOptions).build();
        builder.clientOptions(clientOptions);
        if (ssl) builder.useSsl();

        LettuceConnectionFactory factory;
        if (StringUtils.isNotBlank(clusters)) {
            logger.info("Prepare reactive Session Stream reader for cluster redis:{}", clusters);
            RedisClusterConfiguration configuration = new RedisClusterConfiguration(
                new HashSet<>(Arrays.asList(clusters.split(","))));
            applyCredentials(configuration);
            if (StringUtils.isNotBlank(maxRedirects)) configuration.setMaxRedirects(Integer.parseInt(maxRedirects));
            factory = new LettuceConnectionFactory(configuration, builder.build());
        }
        else if (StringUtils.isNotBlank(sentinels)) {
            logger.info("Prepare reactive Session Stream reader for sentinel redis:{},{}", master, sentinels);
            RedisSentinelConfiguration configuration = new RedisSentinelConfiguration(master,
                new HashSet<>(Arrays.asList(sentinels.split(","))));
            applyCredentials(configuration);
            configuration.setDatabase(parseDatabase());
            factory = new LettuceConnectionFactory(configuration, builder.build());
        }
        else if (StringUtils.isNotBlank(host) && StringUtils.isNotBlank(port)) {
            logger.info("Prepare reactive Session Stream reader for standalone redis:{},{}", host, port);
            RedisStandaloneConfiguration configuration = new RedisStandaloneConfiguration(host,
                Integer.parseInt(port));
            applyCredentials(configuration);
            configuration.setDatabase(parseDatabase());
            factory = new LettuceConnectionFactory(configuration, builder.build());
        }
        else if (StringUtils.isNotBlank(url)) {
            RedisURI redisUri = RedisURI.create(url);
            if (redisUri.isSsl()) builder.useSsl();
            RedisStandaloneConfiguration configuration = new RedisStandaloneConfiguration(redisUri.getHost(),
                redisUri.getPort());
            if (StringUtils.isNotBlank(redisUri.getUsername())) configuration.setUsername(redisUri.getUsername());
            if (redisUri.getPassword() != null) configuration.setPassword(RedisPassword.of(redisUri.getPassword()));
            configuration.setDatabase(redisUri.getDatabase());
            logger.info("Prepare reactive Session Stream reader from redis URL host:{}, port:{}",
                redisUri.getHost(), redisUri.getPort());
            factory = new LettuceConnectionFactory(configuration, builder.build());
        }
        else {
            throw new BdpRuntimeException(I18nUtil.get("redis.configuration.error"));
        }
        factory.setShareNativeConnection(true);
        return factory;
    }

    @Bean("sessionStreamReactiveRedisTemplate")
    public ReactiveRedisTemplate<String, String> sessionStreamReactiveRedisTemplate(
            LettuceConnectionFactory sessionStreamReactiveRedisConnectionFactory) {
        return new ReactiveRedisTemplate<>(sessionStreamReactiveRedisConnectionFactory,
            RedisSerializationContext.string());
    }

    private void applyCredentials(RedisStandaloneConfiguration configuration) {
        if (StringUtils.isNotBlank(username)) configuration.setUsername(username);
        String resolvedPassword = resolvedPassword();
        if (StringUtils.isNotBlank(resolvedPassword)) configuration.setPassword(resolvedPassword);
    }

    private void applyCredentials(RedisSentinelConfiguration configuration) {
        if (StringUtils.isNotBlank(username)) configuration.setUsername(username);
        String resolvedPassword = resolvedPassword();
        if (StringUtils.isNotBlank(resolvedPassword)) configuration.setPassword(resolvedPassword);
    }

    private void applyCredentials(RedisClusterConfiguration configuration) {
        if (StringUtils.isNotBlank(username)) configuration.setUsername(username);
        String resolvedPassword = resolvedPassword();
        if (StringUtils.isNotBlank(resolvedPassword)) configuration.setPassword(resolvedPassword);
    }

    private String resolvedPassword() {
        if (StringUtils.isBlank(password)) return password;
        if (encrypt) {
            logger.warn("Prepare to connect to redis with encrypt password...");
            return RsaDecrypt.decrypt(password);
        }
        return password;
    }

    private int parseDatabase() {
        return StringUtils.isBlank(database) ? 0 : Integer.parseInt(database);
    }

    private RedisConnectionFactory createConnectionFactory(CustomJedisPoolConfig poolConfig) {

        JedisClientConfiguration.DefaultJedisClientConfigurationBuilder clientConfigBuilder = (JedisClientConfiguration.DefaultJedisClientConfigurationBuilder) JedisClientConfiguration
            .builder();
        clientConfigBuilder.poolConfig(poolConfig);
        clientConfigBuilder.usePooling();
        clientConfigBuilder.connectTimeout(Duration.ofMillis(timeout));

        // 设置读写超时，避免连接挂起
        clientConfigBuilder.readTimeout(Duration.ofMillis(readTimeout));

        if (ssl) {
            clientConfigBuilder.useSsl();
        }

        logger.info("Creating Redis connection factory with pool config: {}", poolConfig);

        JedisConnectionFactory redisFactory = null;
        if (StringUtils.isNotBlank(clusters)) {
            logger.info("Prepare to connect to cluster redis:" + clusters);
            RedisClusterConfiguration clusterConfig = new RedisClusterConfiguration(
                new HashSet(Arrays.asList(clusters.split(","))));
            if (StringUtils.isNotBlank(maxRedirects)) {
                clusterConfig.setMaxRedirects(Integer.parseInt(maxRedirects));
            }
            redisFactory = new JedisConnectionFactory(clusterConfig, clientConfigBuilder.build());
        }
        else if (StringUtils.isNotBlank(sentinels)) {
            logger.info("Prepare to connect to sentinel redis:" + master + "," + sentinels);
            RedisSentinelConfiguration sentinelConfig = new RedisSentinelConfiguration(master,
                new HashSet(Arrays.asList(sentinels.split(","))));
            redisFactory = new JedisConnectionFactory(sentinelConfig, clientConfigBuilder.build());
        }
        else if (StringUtils.isNotBlank(host) && StringUtils.isNotBlank(port)) {
            logger.info("Prepare to connect to standalone redis:" + host + "," + port);
            RedisStandaloneConfiguration standaloneConfig = new RedisStandaloneConfiguration(host,
                Integer.parseInt(port));
            standaloneConfig.setPassword(password);
            redisFactory = new JedisConnectionFactory(standaloneConfig, clientConfigBuilder.build());
        }
        else if (StringUtils.isNotBlank(url)) {
            logger.info("Prepare to connect to redis url:" + url);
            RedisStandaloneConfiguration standaloneConfig = new RedisStandaloneConfiguration(host,
                Integer.parseInt(port));
            if (StringUtils.isNotBlank(username)) {
                standaloneConfig.setUsername(username);
            }
            redisFactory = new JedisConnectionFactory(standaloneConfig, clientConfigBuilder.build());
        }
        else {
            throw new BdpRuntimeException(I18nUtil.get("redis.configuration.error"));
        }

        this.ncssRedisConnectionFactory(redisFactory);
        return redisFactory;
    }

    private void ncssRedisConnectionFactory(JedisConnectionFactory redisFactory) {
        if (StringUtils.isNotBlank(password)) {
            if (encrypt) {
                logger.warn("Prepare to connect to redis with encrypt password...");
                redisFactory.setPassword(RsaDecrypt.decrypt(password));
            }
            else {
                logger.warn("Prepare to connect to redis with decrypt password...");
                redisFactory.setPassword(password);
            }
        }
        if (StringUtils.isNotBlank(database)) {
            redisFactory.setDatabase(Integer.parseInt(database));
        }
    }

    @Bean("springSessionDefaultRedisSerializer")
    @ConditionalOnProperty(prefix = "spring.session", value = "redis-serializer", matchIfMissing = false,
        havingValue = "json")
    public RedisSerializer<Object> springSessionJsonRedisSerializer(ApplicationContext applicationContext) {
        // 反序列化会导致整形类型的数值泛型丢失
        return new Jackson2JsonRedisSerializer(Object.class);
        // return new RedisSessionJacksonRedisSerializer(applicationContext);
    }

    @Bean
    public org.springframework.session.config.SessionRepositoryCustomizer<RedisSessionRepository> sessionRepositoryCustomizer() {
        return repository -> {
            repository.setDefaultMaxInactiveInterval(sessionTimeout);
            repository.setRedisSessionMapper(new SafeRedisSessionMapper());
        };
    }

    @Bean
    public RedisMessageListenerContainer redisMessageListenerContainer() {
        RedisMessageListenerContainer redisMessageListenerContainer = new RedisMessageListenerContainer();
        redisMessageListenerContainer.setConnectionFactory(connectionFactory());
        return redisMessageListenerContainer;
    }

    // kvstore Unable to configure Redis to keyspace notifications
    @Bean
    ConfigureRedisAction configureRedisAction() {
        return ConfigureRedisAction.NO_OP;
    }
}
