package com.iwhalecloud.byai.manager.infrastructure.kafka;

import java.util.Properties;
import org.springframework.core.env.Environment;

/**
 * 读取kafka配置文件信息
 */
public class ZlogKafkaConfig extends Properties {

    private final Environment environment;

    public ZlogKafkaConfig(Environment environment) {
        this.environment = environment;
    }

    /**
     * 返回固定前缀的kafka配置
     * 
     * @param key properties对应的key
     * @return 对应值
     */
    @Override
    public String getProperty(String key) {
        return this.environment.getProperty("zlog.adapter.kafka." + key);
    }

    /**
     * 重写equals方法，消除FindBugs告警
     */
    @Override
    public boolean equals(Object o) {
        return super.equals(o);
    }

    /**
     * 重写hashCode方法，消除FindBugs告警
     */
    @Override
    public int hashCode() {
        return super.hashCode();
    }
}
