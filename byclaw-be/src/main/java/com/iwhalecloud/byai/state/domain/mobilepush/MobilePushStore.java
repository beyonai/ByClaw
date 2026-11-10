package com.iwhalecloud.byai.state.domain.mobilepush;

import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 手机设备绑定存储；只保留一张表，以条件更新隔离换号和迟到解绑。 */
@Repository
public class MobilePushStore {
    private final JdbcTemplate jdbc;

    public MobilePushStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 安装实例的递增版本阻止超时请求、旧账号解绑覆盖新绑定。 */
    public boolean bind(long accountId, PushDeviceBinding binding) {
        return jdbc.update("""
            INSERT INTO byai.byai_mobile_push_device
                (installation_id, account_id, revision, registration_id, platform, language, enabled, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, true, CURRENT_TIMESTAMP)
            ON CONFLICT (installation_id) DO UPDATE SET
                account_id = EXCLUDED.account_id, revision = EXCLUDED.revision,
                registration_id = EXCLUDED.registration_id, platform = EXCLUDED.platform,
                language = EXCLUDED.language, enabled = true, updated_at = CURRENT_TIMESTAMP
            WHERE byai_mobile_push_device.revision < EXCLUDED.revision
            """, binding.installationId(), accountId, binding.revision(), binding.registrationId(),
            binding.platform(), binding.language()) == 1;
    }

    /** 解绑保留版本墓碑；未完成的首次绑定也不能在用户关闭提醒后重新生效。 */
    public void unbind(long accountId, String installationId, long revision) {
        jdbc.update("""
            INSERT INTO byai.byai_mobile_push_device
                (installation_id, account_id, revision, registration_id, platform, language, enabled, updated_at)
            VALUES (?, ?, ?, '', 'android', 'zh-CN', false, CURRENT_TIMESTAMP)
            ON CONFLICT (installation_id) DO UPDATE SET
                revision = EXCLUDED.revision, registration_id = '', enabled = false,
                updated_at = CURRENT_TIMESTAMP
            WHERE byai_mobile_push_device.account_id = EXCLUDED.account_id
                AND byai_mobile_push_device.revision < EXCLUDED.revision
            """, installationId, accountId, revision);
    }

    /** 只持久保存设备归属；消息发送在异步线程中读取当前有效设备。 */
    public List<PushDeviceBinding> devices(long accountId) {
        return jdbc.query("""
            SELECT installation_id, revision, registration_id, platform, language
            FROM byai.byai_mobile_push_device WHERE account_id = ? AND enabled = true
            """, (row, rowNumber) -> new PushDeviceBinding(row.getString("installation_id"),
                row.getLong("revision"), row.getString("registration_id"),
                row.getString("platform"), row.getString("language")), accountId);
    }

    /** 每次发送前重读当前绑定，账号切换和关闭通知后旧通知直接失效。 */
    public PushDeviceBinding device(PushNotification notification) {
        List<PushDeviceBinding> devices = jdbc.query("""
            SELECT installation_id, revision, registration_id, platform, language
            FROM byai.byai_mobile_push_device WHERE installation_id = ? AND account_id = ?
                AND revision = ? AND enabled = true
            """, (row, rowNumber) -> new PushDeviceBinding(row.getString("installation_id"),
                row.getLong("revision"), row.getString("registration_id"),
                row.getString("platform"), row.getString("language")),
            notification.installationId(), notification.accountId(), notification.deviceRevision());
        return devices.isEmpty() ? null : devices.getFirst();
    }
}
