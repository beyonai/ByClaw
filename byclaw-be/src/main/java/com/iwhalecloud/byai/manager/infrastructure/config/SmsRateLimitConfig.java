package com.iwhalecloud.byai.manager.infrastructure.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "sms.rate.limit")
public class SmsRateLimitConfig {
    
    /**
     * IP限制时间窗口(分钟)
     */
    private int intervalMinutes = 5;
    
    /**
     * IP时间窗口内最大发送次数
     */
    private int maxCount = 3;
    
    /**
     * 同一手机号重复发送间隔(分钟)
     */
    private int repeatedInterval = 1;

    /**
     * 短信验证码过期时间(分钟)/图形验证码过期时间
     */
    private int smsExpireTime = 2;

    public int getIntervalMinutes() {
        return intervalMinutes;
    }

    public void setIntervalMinutes(int intervalMinutes) {
        this.intervalMinutes = intervalMinutes;
    }

    public int getMaxCount() {
        return maxCount;
    }

    public void setMaxCount(int maxCount) {
        this.maxCount = maxCount;
    }

    public int getRepeatedInterval() {
        return repeatedInterval;
    }

    public void setRepeatedInterval(int repeatedInterval) {
        this.repeatedInterval = repeatedInterval;
    }

    public int getSmsExpireTime() {
        return smsExpireTime;
    }

    public void setSmsExpireTime(int smsExpireTime) {
        this.smsExpireTime = smsExpireTime;
    }
}