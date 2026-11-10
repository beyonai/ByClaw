package com.iwhalecloud.byai.state.domain.mobilepush;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** 仅在内存中传递定位信息和设备版本，不持久保存任务、正文、凭证或设备 token。 */
public record PushNotification(
    String notificationId,
    long enterpriseId,
    long sessionId,
    long messageId,
    long accountId,
    String installationId,
    long deviceRevision
) {
    /** 相同接收账号和安装实例的重复广播共享短期去重身份，换号不会占用另一账号的身份。 */
    public static PushNotification create(String applicationScope, long enterpriseId, long sessionId,
                                           long messageId, long accountId, PushDeviceBinding device) {
        String identity = applicationScope + ":" + enterpriseId + ":" + sessionId + ":" + messageId
            + ":" + accountId + ":" + device.installationId();
        try {
            String notificationId = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(identity.getBytes(StandardCharsets.UTF_8)));
            return new PushNotification(notificationId, enterpriseId, sessionId, messageId, accountId,
                device.installationId(), device.revision());
        } catch (NoSuchAlgorithmException failure) {
            throw new IllegalStateException("SHA-256 unavailable", failure);
        }
    }
}
