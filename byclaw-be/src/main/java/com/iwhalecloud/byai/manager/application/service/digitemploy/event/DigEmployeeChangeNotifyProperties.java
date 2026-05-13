package com.iwhalecloud.byai.manager.application.service.digitemploy.event;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 数字员工变更通知（Redis Pub/Sub）配置。
 */
@ConfigurationProperties(prefix = "byai.dig-employee-change")
public class DigEmployeeChangeNotifyProperties {

    /**
     * 是否发布变更事件（管理端 {@code PUBLISH}）。
     */
    private boolean publishEnabled = true;

    /**
     * Pub/Sub 频道名，与 {@link org.springframework.data.redis.core.StringRedisTemplate#convertAndSend} 的 destination 一致。
     */
    private String pubsubChannel = "byai:pub:dig_employee_change";

    /**
     * 是否在发布后异步按授权展开用户并刷新 {@code USER:RESOURCES:AUTH}（较重，默认关闭）。
     */
    private boolean authRefreshEnabled = false;

    private final Subscriber subscriber = new Subscriber();

    public boolean isPublishEnabled() {
        return publishEnabled;
    }

    public void setPublishEnabled(boolean publishEnabled) {
        this.publishEnabled = publishEnabled;
    }

    public String getPubsubChannel() {
        return pubsubChannel;
    }

    public void setPubsubChannel(String pubsubChannel) {
        this.pubsubChannel = pubsubChannel;
    }

    public boolean isAuthRefreshEnabled() {
        return authRefreshEnabled;
    }

    public void setAuthRefreshEnabled(boolean authRefreshEnabled) {
        this.authRefreshEnabled = authRefreshEnabled;
    }

    public Subscriber getSubscriber() {
        return subscriber;
    }

    /**
     * 本进程是否注册 {@link org.springframework.data.redis.listener.RedisMessageListenerContainer} 订阅。
     */
    public static class Subscriber {

        private boolean enabled = false;

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }
    }
}
