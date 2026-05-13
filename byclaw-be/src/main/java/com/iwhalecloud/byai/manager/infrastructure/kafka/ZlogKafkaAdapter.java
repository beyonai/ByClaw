package com.iwhalecloud.byai.manager.infrastructure.kafka;

import org.apache.commons.lang3.StringUtils;
import org.apache.kafka.common.security.auth.SecurityProtocol;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.core.ProducerFactory;
import org.springframework.kafka.support.SendResult;

import java.util.HashMap;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.CompletableFuture;

/***
 * kafka适配
 */
public class ZlogKafkaAdapter {

    private KafkaTemplate<String, String> kafkaTemplate = null;

    public ZlogKafkaAdapter(Properties properties) {

        Properties config = this.createConfigs(properties);

        Map<String, Object> configs = new HashMap();

        for (String key : config.stringPropertyNames()) {
            configs.put(key, config.getProperty(key));
        }

        ProducerFactory<String, String> producerFactory = new DefaultKafkaProducerFactory(configs);
        this.kafkaTemplate = new KafkaTemplate(producerFactory);
    }

    /**
     * 发送kafka的消息
     *
     * @param topic 发送的主题
     * @param message 发送kafka消息
     * @return
     */
    public CompletableFuture<SendResult<String, String>> send(String topic, String message) {
        return this.kafkaTemplate.send(topic, message);
    }

    /**
     * 配置文件获取
     * 
     * @param config 配置文件
     * @return Properties
     */
    private Properties createConfigs(Properties config) {
        String brokers = config.getProperty("kafkaUrl");
        String authMode = config.getProperty("authMode");
        String userName = config.getProperty("username");
        String password = config.getProperty("password");
        String keystoreLocation = config.getProperty("keystoreLocation");
        String keystorePassword = config.getProperty("keystorePassword");
        String truststoreLocation = config.getProperty("truststoreLocation");
        String truststorePassword = config.getProperty("truststorePassword");
        String keyPassword = config.getProperty("keyPassword");
        String saslMechanism = config.getProperty("saslMechanism");
        String kdc = config.getProperty("kdc");
        String realm = config.getProperty("realm");
        String jaasConf = config.getProperty("jaasConf");
        String krb5Conf = config.getProperty("krb5Conf");
        String format = config.getProperty("dataFormat");
        Properties properties = new Properties();
        properties.put("bootstrap.servers", brokers);
        properties.put("acks", "1");
        properties.put("retries", "10");
        properties.put("linger.ms", "1000");
        properties.put("batch.size", "100000");
        properties.put("buffer.memory", String.valueOf(268435456));
        properties.put("request.timeout.ms", "120000");
        properties.put("compression.type", "none");
        // 设置为 10MB
        properties.put("max.request.size", 10 * 1024 * 1024);
        if (!"PROTOBUF".equalsIgnoreCase(format) && !"UE".equalsIgnoreCase(format)) {
            properties.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
            properties.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");
        }
        else {
            properties.put("key.serializer", "org.apache.kafka.common.serialization.ByteArraySerializer");
            properties.put("value.serializer", "org.apache.kafka.common.serialization.ByteArraySerializer");
        }

        if (StringUtils.isNotEmpty(userName) && StringUtils.isNotEmpty(password)) {
            // 创建认证配置Map
            Map<String, String> authConfigMap = new HashMap<>();
            authConfigMap.put("authMode", authMode);
            authConfigMap.put("userName", userName);
            authConfigMap.put("password", password);
            authConfigMap.put("truststoreLocation", truststoreLocation);
            authConfigMap.put("truststorePassword", truststorePassword);
            authConfigMap.put("keystoreLocation", keystoreLocation);
            authConfigMap.put("keystorePassword", keystorePassword);
            authConfigMap.put("keyPassword", keyPassword);
            authConfigMap.put("saslMechanism", saslMechanism);
            authConfigMap.put("kdc", kdc);
            authConfigMap.put("realm", realm);
            authConfigMap.put("jaasConf", jaasConf);
            authConfigMap.put("krb5Conf", krb5Conf);
            isUsernameAndPasswordValid(properties, authConfigMap);

        }

        return properties;
    }

    /**
     * 验证用户名和密码是否有效，并配置相关认证属性
     *
     * @param properties Kafka配置属性
     * @param authConfigMap 认证配置Map
     */
    private void isUsernameAndPasswordValid(Properties properties, Map<String, String> authConfigMap) {
        // 从Map中解包参数
        String authMode = authConfigMap.get("authMode");
        String userName = authConfigMap.get("userName");
        String password = authConfigMap.get("password");
        String truststoreLocation = authConfigMap.get("truststoreLocation");
        String truststorePassword = authConfigMap.get("truststorePassword");
        String keystoreLocation = authConfigMap.get("keystoreLocation");
        String keystorePassword = authConfigMap.get("keystorePassword");
        String keyPassword = authConfigMap.get("keyPassword");
        String saslMechanism = authConfigMap.get("saslMechanism");
        String kdc = authConfigMap.get("kdc");
        String realm = authConfigMap.get("realm");
        String jaasConf = authConfigMap.get("jaasConf");
        String krb5Conf = authConfigMap.get("krb5Conf");

        if (StringUtils.equalsAnyIgnoreCase(authMode, new CharSequence[] {
            "scram", "LDAP"
        })) {
            properties.put("security.protocol", SecurityProtocol.SASL_PLAINTEXT.name);
            properties.put("sasl.mechanism", "SCRAM-SHA-512");
            String value = String.format(
                "org.apache.kafka.common.security.scram.ScramLoginModule required username=\"%s\" password=\"%s\";",
                userName, password);
            properties.put("sasl.jaas.config", value);
        }
        else if ("plain".equalsIgnoreCase(authMode)) {
            properties.put("security.protocol", "SASL_PLAINTEXT");
            properties.put("sasl.mechanism", "PLAIN");
            properties.put("sasl.jaas.config",
                "org.apache.kafka.common.security.plain.PlainLoginModule required username=\"" + userName
                    + "\" password=\"" + password + "\";");
        }
        else if (StringUtils.equalsAnyIgnoreCase(authMode, new CharSequence[] {
            "ssl", "sasl_ssl"
        })) {
            properties.put("ssl.truststore.location", truststoreLocation);
            properties.put("ssl.truststore.password", truststorePassword);
            properties.put("security.protocol", authMode.toUpperCase());
            properties.put("ssl.endpoint.identification.algorithm", "");
            configureKafkaSecurityProperties(properties, userName, password, keystoreLocation, keystorePassword,
                keyPassword, saslMechanism);
        }
        else if ("kerberos".equalsIgnoreCase(authMode)) {
            configureKerberosSystemProperties(kdc, realm, jaasConf, krb5Conf);
            properties.put("enable.auto.commit", "false");
            properties.put("auto.commit.interval.ms", "1000");
            properties.put("auto.offset.reset", "earliest");
            properties.put("session.timeout.ms", "30000");
            properties.put("security.protocol", "SASL_PLAINTEXT");
            properties.put("sasl.mechanism", "GSSAPI");
            properties.put("sasl.kerberos.service.name", "kafka");
        }
    }

    private static void configureKerberosSystemProperties(String kdc, String realm, String jaasConf, String krb5Conf) {
        if (StringUtils.isNotBlank(kdc)) {
            System.setProperty("java.security.krb5.kdc", kdc);
        }

        if (StringUtils.isNotBlank(realm)) {
            System.setProperty("java.security.krb5.realm", realm);
        }

        if (StringUtils.isNotBlank(jaasConf)) {
            System.setProperty("java.security.auth.login.config", jaasConf);
        }

        if (StringUtils.isNotBlank(krb5Conf)) {
            System.setProperty("java.security.krb5.conf", krb5Conf);
        }
    }

    private static void configureKafkaSecurityProperties(Properties properties, String userName, String password,
        String keystoreLocation, String keystorePassword, String keyPassword, String saslMechanism) {
        if (StringUtils.isNotEmpty(keystoreLocation)) {
            properties.put("ssl.keystore.location", keystoreLocation);
        }

        if (StringUtils.isNotEmpty(keystorePassword)) {
            properties.put("ssl.keystore.password", keystorePassword);
        }

        if (StringUtils.isNotEmpty(keyPassword)) {
            properties.put("ssl.key.password", keyPassword);
        }

        if ("scram".equalsIgnoreCase(saslMechanism)) {
            properties.put("sasl.mechanism", "SCRAM-SHA-512");
            String value = String.format(
                "org.apache.kafka.common.security.scram.ScramLoginModule required username=\"%s\" password=\"%s\";",
                userName, password);
            properties.put("sasl.jaas.config", value);
        }
        else if ("plain".equalsIgnoreCase(saslMechanism)) {
            properties.put("sasl.mechanism", "PLAIN");
            properties.put("sasl.jaas.config",
                "org.apache.kafka.common.security.plain.PlainLoginModule required username=\"" + userName
                    + "\" password=\"" + password + "\";");
        }
    }
}
