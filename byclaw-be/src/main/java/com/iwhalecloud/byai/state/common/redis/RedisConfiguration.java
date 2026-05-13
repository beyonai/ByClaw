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
import org.springframework.data.redis.connection.RedisSentinelConfiguration;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.jedis.JedisClientConfiguration;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.data.redis.serializer.Jackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializer;
import org.springframework.session.data.redis.config.ConfigureRedisAction;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;

@ConditionalOnProperty(prefix = "spring.redis", value = "enabled", matchIfMissing = true)
@Configuration
public class RedisConfiguration {
    private static Logger logger = LoggerFactory.getLogger(RedisConfiguration.class);

    @Autowired
    private RedisProperties redisProperties;

    // 连接超时配置
    @Value("${spring.redis.timeout:2000}")
    private int timeout;

    @Value("${spring.redis.read-timeout:2000}")
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

    @Primary
    @Bean
    public RedisConnectionFactory connectionFactory() {
        CustomJedisPoolConfig poolConfig = new CustomJedisPoolConfig();

        // 使用RedisProperties配置连接池
        poolConfig.setPoolConfig(redisProperties);

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