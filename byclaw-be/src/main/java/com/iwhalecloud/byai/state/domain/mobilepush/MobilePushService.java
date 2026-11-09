package com.iwhalecloud.byai.state.domain.mobilepush;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.Executor;

import com.alibaba.fastjson.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

/** 消息提交后的尽力通知；只有设备绑定落库，发送失败或进程退出均不持久补发。 */
@Service
public class MobilePushService {
    private static final Logger LOG = LoggerFactory.getLogger(MobilePushService.class);
    private static final long MAX_WAIT_NANOS = Duration.ofMinutes(1).toNanos();
    private final MobilePushProperties properties;
    private final MobilePushStore store;
    private final MobilePushAuthority authority;
    private final TencentPushClient client;
    private final MobilePushRateLimiter rateLimiter;
    private final Executor executor;

    public MobilePushService(MobilePushProperties properties, MobilePushStore store,
                             MobilePushAuthority authority, TencentPushClient client,
                             MobilePushRateLimiter rateLimiter,
                             @Qualifier("mobilePushExecutor") Executor executor) {
        this.properties = properties;
        this.store = store;
        this.authority = authority;
        this.client = client;
        this.rateLimiter = rateLimiter;
        this.executor = executor;
    }

    /** 只提交完整新消息的定位快照，不让异步任务引用可变事件或完整聊天正文。 */
    public void notifyMembers(long enterpriseId, JSONObject event, List<Long> recipientIds) {
        if (!properties.ready() || enterpriseId <= 0 || event == null || recipientIds == null
            || !"MESSAGE_CREATED".equals(event.getString("event"))) {
            return;
        }
        try {
            String sessionId = event.getString("sessionId");
            String messageId = event.getString("messageId");
            if (sessionId == null || messageId == null || !sessionId.matches("[1-9][0-9]{0,18}")
                || !messageId.matches("[1-9][0-9]{0,18}")) {
                return;
            }
            long session = Long.parseLong(sessionId);
            long message = Long.parseLong(messageId);
            JSONObject speaker = event.getJSONObject("speaker");
            String sender = speaker != null && "USER".equalsIgnoreCase(speaker.getString("type"))
                ? event.getString("creatorId") : null;
            List<Long> recipients = recipientIds.stream().filter(accountId -> accountId != null
                && accountId > 0 && !accountId.toString().equals(sender)).distinct().toList();
            if (!recipients.isEmpty()) {
                long submittedAt = System.nanoTime();
                executor.execute(() -> sendToMembers(enterpriseId, session, message, recipients, submittedAt));
            }
        } catch (RuntimeException failure) {
            // 包括有界执行器满载：通知可舍弃，不能退回聊天请求线程执行或泄露原始事件。
            LOG.warn("Mobile push submission skipped, enterpriseId={}", enterpriseId);
        }
    }

    private boolean current(long submittedAt) {
        return properties.ready() && !Thread.currentThread().isInterrupted()
            && System.nanoTime() - submittedAt < MAX_WAIT_NANOS;
    }

    private void sendToMembers(long enterpriseId, long sessionId, long messageId,
                               List<Long> recipients, long submittedAt) {
        for (Long accountId : recipients) {
            if (!current(submittedAt)) {
                return;
            }
            try {
                // 设备在执行时才读取，等待期间退出或换号后不会沿用旧注册标识。
                for (PushDeviceBinding device : store.devices(accountId)) {
                    if (!current(submittedAt)) {
                        return;
                    }
                    PushNotification notification = PushNotification.create(
                        properties.getSdkAppId() + ":" + properties.getEnvironmentId(), enterpriseId,
                        sessionId, messageId, accountId, device);
                    send(notification, device, submittedAt);
                }
            } catch (RuntimeException failure) {
                LOG.warn("Mobile push recipient skipped, enterpriseId={}, sessionId={}, messageId={}, accountId={}",
                    enterpriseId, sessionId, messageId, accountId);
            }
        }
    }

    private void send(PushNotification notification, PushDeviceBinding device, long submittedAt) {
        try {
            if (!authority.allowed(notification) || !rateLimiter.awaitSlot() || !current(submittedAt)) {
                return;
            }
            // 权限查询和短期限速等待后，再核对账号、安装实例及版本；只发送一次，不重试 HTTP。
            if (store.device(notification) == null || !rateLimiter.firstAttempt(notification.notificationId())) {
                return;
            }
            int code = client.send(notification, device);
            if (code != 0) {
                LOG.warn("Mobile push not accepted, notificationId={}, code={}", notification.notificationId(), code);
            }
        } catch (RuntimeException failure) {
            // 通知适配器与数据库异常都不输出原始载荷、token 或带 UserSig 的 URL。
            LOG.warn("Mobile push skipped, notificationId={}", notification.notificationId());
        }
    }
}
