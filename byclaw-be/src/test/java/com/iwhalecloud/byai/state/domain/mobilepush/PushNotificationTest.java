package com.iwhalecloud.byai.state.domain.mobilepush;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class PushNotificationTest {
    @Test
    void stableIdentitySeparatesApplicationsEnvironmentsAccountsAndInstallations() {
        var device = new PushDeviceBinding("installation-test-device", 1, "registration", "ios", "zh-CN");
        var notification = PushNotification.create("123:production", 1, 30, 40, 22, device);
        assertThat(notification.notificationId()).matches("[0-9a-f]{64}");
        assertThat(PushNotification.create("123:production", 1, 30, 40, 22, device)).isEqualTo(notification);
        assertThat(PushNotification.create("123:development", 1, 30, 40, 22, device).notificationId())
            .isNotEqualTo(notification.notificationId());
        assertThat(PushNotification.create("456:production", 1, 30, 40, 22, device).notificationId())
            .isNotEqualTo(notification.notificationId());
        assertThat(PushNotification.create("123:production", 1, 30, 40, 23, device).notificationId())
            .isNotEqualTo(notification.notificationId());
        var another = new PushDeviceBinding("installation-test-second", 1, "other-registration", "android", "en");
        assertThat(PushNotification.create("123:production", 1, 30, 40, 22, another).notificationId())
            .isNotEqualTo(notification.notificationId());
        // 同账号重注册不能因版本变化绕过去重，但发送前仍以版本快照验证绑定。
        var rebound = new PushDeviceBinding(device.installationId(), 2, "new-registration", "ios", "zh-CN");
        var updated = PushNotification.create("123:production", 1, 30, 40, 22, rebound);
        assertThat(updated.notificationId()).isEqualTo(notification.notificationId());
        assertThat(updated.deviceRevision()).isEqualTo(2);
    }
}
