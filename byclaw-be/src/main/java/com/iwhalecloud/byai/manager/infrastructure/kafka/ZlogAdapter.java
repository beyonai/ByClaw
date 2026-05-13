package com.iwhalecloud.byai.manager.infrastructure.kafka;

import java.util.Properties;
import java.util.concurrent.CompletableFuture;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.env.Environment;
import org.springframework.kafka.support.SendResult;
import org.springframework.stereotype.Component;

/**
 * 初始化kafka连接信息
 */
@Component
@ConditionalOnProperty(name = "zlog.adapter.kafka.enabled", havingValue = "true")
public class ZlogAdapter implements InitializingBean {

    private static Logger logger = LoggerFactory.getLogger(ZlogAdapter.class);

    @Autowired
    private Environment environment;

    private ZlogKafkaAdapter zlogKafkaAdapter;

    public ZlogAdapter() {
    }

    /**
     * 加载完成配置文件后，初始化kafka连接
     *
     * @throws Exception
     */
    @Override
    public void afterPropertiesSet() throws Exception {
        try {
            Properties properties = new ZlogKafkaConfig(this.environment);
            this.zlogKafkaAdapter = new ZlogKafkaAdapter(properties);
        }
        catch (Exception ex) {
            logger.error("初始化kafka失败:", ex);
        }

    }

    /**
     * kafka发送消息
     *
     * @param topic   主题
     * @param message 发送的文本消息
     */
    public CompletableFuture<SendResult<String, String>> send(String topic, String message) {

        return zlogKafkaAdapter.send(topic, message);

    }

}
