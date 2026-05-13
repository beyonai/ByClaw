package com.iwhalecloud.byai.state.application.service.limit;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Date;

import com.iwhalecloud.byai.common.util.StringUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

/**
 * 聊天调用次数限制服务 基于 Redis 实现用户每日调用次数限制
 */
@Service
public class ChatCallLimitService {

    public static final Logger LOGGER = LoggerFactory.getLogger(ChatCallLimitService.class);

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    @Autowired
    private ByaiSystemConfigService systemConfigService;

    private static final String CHAT_LIMIT_KEY_PREFIX = "chat:limit:";

    /**
     * 检查并增加用户调用次数
     * 
     * @param userId 用户ID
     * @return true-未超限可以继续调用，false-已超限
     */
    public boolean checkAndIncrementCallCount(Long userId) {
        if (userId == null) {
            LOGGER.warn("用户ID为空，跳过调用次数限制检查");
            return true;
        }

        String date = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
        String limitKey = CHAT_LIMIT_KEY_PREFIX + userId + ":" + date;

        // 获取今日限制次数
        int dailyLimit = this.getDailyChatLimit();

        // 使用 Redis 的 INCR 命令原子性增加计数
        Long currentCount = redisTemplate.opsForValue().increment(limitKey);

        // 设置过期时间为当天结束
        if (currentCount == 1) {
            redisTemplate.expireAt(limitKey, getEndOfDay());
        }

        // 检查是否超限
        if (currentCount > dailyLimit) {
            LOGGER.info("用户{}今日聊天调用次数超限: {}/{}", userId, currentCount, dailyLimit);
            return false;
        }

        LOGGER.info("用户{}今日聊天调用次数: {}/{}", userId, currentCount, dailyLimit);
        return true;

    }

    /**
     * 获取每日聊天调用限制次数
     *
     * @return 每日限制次数，默认500次
     */
    private int getDailyChatLimit() {
        String dailyChatLimit = systemConfigService.getDcSystemConfigValueByCode("DAILY_CHAT_LIMIT");
        return StringUtil.isNotEmpty(dailyChatLimit) ? Integer.parseInt(dailyChatLimit) : 500;
    }

    /**
     * 获取用户今日调用次数
     * 
     * @param userId 用户ID
     * @return 今日调用次数
     */
    public int getUserTodayCallCount(Long userId) {
        if (userId == null) {
            return 0;
        }

        try {
            String date = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
            String key = CHAT_LIMIT_KEY_PREFIX + userId + ":" + date;
            String count = redisTemplate.opsForValue().get(key);
            return count != null ? Integer.parseInt(count) : 0;
        }
        catch (Exception e) {
            LOGGER.error("获取用户{}今日调用次数时发生异常: {}", userId, e.getMessage(), e);
            return 0;
        }
    }

    /**
     * 获取用户剩余调用次数
     * 
     * @param userId 用户ID
     * @return 剩余调用次数
     */
    public int getUserRemainingCallCount(Long userId) {
        if (userId == null) {
            return 0;
        }

        try {
            int dailyLimit = this.getDailyChatLimit();
            int usedCount = getUserTodayCallCount(userId);
            return Math.max(0, dailyLimit - usedCount);
        }
        catch (Exception e) {
            LOGGER.error("获取用户{}剩余调用次数时发生异常: {}", userId, e.getMessage(), e);
            return 0;
        }
    }

    /**
     * 重置用户今日调用次数（管理员功能）
     * 
     * @param userId 用户ID
     * @return 是否重置成功
     */
    public boolean resetUserTodayCallCount(Long userId) {
        if (userId == null) {
            return false;
        }

        try {
            String date = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
            String limitKey = CHAT_LIMIT_KEY_PREFIX + userId + ":" + date;
            redisTemplate.delete(limitKey);
            LOGGER.info("重置用户{}今日调用次数成功", userId);
            return true;
        }
        catch (Exception e) {
            LOGGER.error("重置用户{}今日调用次数时发生异常: {}", userId, e.getMessage(), e);
            return false;
        }
    }

    /**
     * 获取当天结束时间
     * 
     * @return 当天结束时间
     */
    private Date getEndOfDay() {
        LocalDateTime endOfDay = LocalDate.now().atTime(23, 59, 59);
        return Date.from(endOfDay.atZone(ZoneId.systemDefault()).toInstant());
    }
}