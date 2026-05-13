package com.iwhalecloud.byai.manager.application.service.digitemploy.event;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.alibaba.fastjson2.JSON;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;

/**
 * 将数字员工变更事件通过 Redis Pub/Sub 广播（管理端 {@code PUBLISH}）。
 * <p>
 * 元数据变更不走 {@link com.iwhalecloud.byai.manager.application.service.auth.AuthRedisSyncService#asyncSyncAuthChangedUsers}，
 * 依赖本通道通知各实例；消息体为整条事件 JSON 字符串（非 Stream Hash 的 {@code payload} 字段嵌套）。
 */
@Service
public class DigEmployeeChangeEventPublisher {

    private static final Logger logger = LoggerFactory.getLogger(DigEmployeeChangeEventPublisher.class);

    private static final String SOURCE_MANAGER = "manager-api";

    @Autowired
    private StringRedisTemplate stringRedisTemplate;

    @Autowired
    private DigEmployeeChangeNotifyProperties properties;

    @Autowired
    @Lazy
    private DigEmployeeChangeAuthRefreshService digEmployeeChangeAuthRefreshService;

    /**
     * 在事务提交后发布；无活跃事务时立即发布。
     */
    public void publishAfterCommitOrNow(DigEmployeeChangeEventType eventType, Long resourceId) {
        if (!properties.isPublishEnabled() || resourceId == null) {
            return;
        }
        Runnable task = () -> publishPayload(eventType, resourceId, SOURCE_MANAGER);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    task.run();
                }
            });
        }
        else {
            task.run();
        }
    }

    /**
     * 非事务路径（如资源工具删除）使用；失败仅打日志。
     */
    public void publishNowQuietly(DigEmployeeChangeEventType eventType, Long resourceId, String source) {
        if (!properties.isPublishEnabled() || resourceId == null) {
            return;
        }
        try {
            publishPayload(eventType, resourceId, StringUtils.defaultIfBlank(source, SOURCE_MANAGER));
        }
        catch (Exception e) {
            logger.warn("Failed to publish dig employee change event quietly, type={}, resourceId={}, err={}",
                eventType, resourceId, e.getMessage());
        }
    }

    private void publishPayload(DigEmployeeChangeEventType eventType, Long resourceId, String source) {
        DigEmployeeChangeEvent event = new DigEmployeeChangeEvent();
        event.setEventType(eventType);
        event.setResourceId(resourceId);
        event.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        event.setChangedAt(System.currentTimeMillis());
        event.setSource(source);
        String json = JSON.toJSONString(event);
        String channel = properties.getPubsubChannel();
        stringRedisTemplate.convertAndSend(channel, json);
        logger.debug("DigEmployee change event published, channel={}, type={}, resourceId={}", channel, eventType,
            resourceId);
        if (properties.isAuthRefreshEnabled()) {
            digEmployeeChangeAuthRefreshService.scheduleRefreshGranteesAsync(resourceId);
        }
    }
}
