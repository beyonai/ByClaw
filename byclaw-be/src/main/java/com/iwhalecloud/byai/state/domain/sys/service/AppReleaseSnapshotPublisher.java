package com.iwhalecloud.byai.state.domain.sys.service;

import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.manager.entity.system.SysAppVersion;
import com.iwhalecloud.byai.manager.mapper.system.SysAppVersionMapper;

/**
 * 把桌面端最新安装包写成落地页可读的 Redis 快照。
 * <p>
 * 本服务只写不读：ByClaw 不感知落地页，落地页也不回查 ByClaw 接口或数据库，
 * 两个模块仅通过约定的 Key 解耦。
 * </p>
 */
@Service
public class AppReleaseSnapshotPublisher {

    /** 落地页约定的只读快照 Key，结构变更需要同步升级版本号。 */
    public static final String SNAPSHOT_KEY = "byai:landing:app-releases:v1";

    private static final Logger logger = LoggerFactory.getLogger(AppReleaseSnapshotPublisher.class);

    private static final String DEVICE_TYPE_DESKTOP = "electron";
    private static final String CHANNEL_STABLE = "stable";
    private static final String UPDATE_STATUS_FORCE = "1";

    private static final DateTimeFormatter PUBLISH_TIME_FORMATTER =
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneId.of("Asia/Shanghai"));

    /** 落地页固定展示的平台/架构组合，避免把后台的历史组合混进快照。 */
    private static final List<Target> RELEASE_TARGETS = List.of(
        new Target("windows", "x64"),
        new Target("windows", "arm64"),
        new Target("macos", "arm64"),
        new Target("macos", "x64"));

    @Autowired
    private StringRedisTemplate stringRedisTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private SysAppVersionMapper sysAppVersionMapper;

    /**
     * 事务内调用则等提交后再写，避免回滚后把未落库的数据发布出去；无事务时立即写。
     */
    public void publishAfterCommit() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    publishNow();
                }
            });
            return;
        }
        publishNow();
    }

    /** 启动后预热一次，保证服务重启不会让快照停留在旧值或缺失。 */
    @EventListener(ApplicationReadyEvent.class)
    public void warmUp() {
        publishNow();
    }

    void publishNow() {
        try {
            List<SysAppVersion> releases = new ArrayList<>(RELEASE_TARGETS.size());
            for (Target target : RELEASE_TARGETS) {
                SysAppVersion version = sysAppVersionMapper.selectLatestVersionByDeviceType(
                    DEVICE_TYPE_DESKTOP, target.platform(), target.arch(), CHANNEL_STABLE);
                if (version != null) {
                    releases.add(version);
                }
            }
            stringRedisTemplate.opsForValue().set(SNAPSHOT_KEY, serialize(releases));
        }
        catch (Exception exception) {
            // 快照只是落地页展示数据，写失败不能让版本管理操作失败。
            logger.warn("Failed to publish landing app release snapshot", exception);
        }
    }

    private String serialize(List<SysAppVersion> releases) throws Exception {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("schemaVersion", 1);
        root.put("generatedAt", System.currentTimeMillis());
        ArrayNode items = root.putArray("releases");
        for (SysAppVersion release : releases) {
            ObjectNode item = items.addObject();
            // 雪花 ID 超出 JS 安全整数范围，必须按字符串传输。
            item.put("versionId", String.valueOf(release.getVersionId()));
            item.put("platform", release.getPlatform());
            item.put("arch", release.getArch());
            item.put("channel", release.getChannel());
            item.put("appVersion", release.getAppVersion());
            item.put("url", release.getUrl());
            item.put("fileName", release.getFileName());
            item.put("fileSize", release.getFileSize());
            item.put("sha256", release.getSha256());
            item.put("updateMsg", release.getUpdateMsg());
            item.put("forceUpdate", UPDATE_STATUS_FORCE.equals(release.getUpdateStatus()));
            item.put("status", release.getReleaseStatus());
            item.put("publishTime",
                release.getPublishTime() == null ? null : PUBLISH_TIME_FORMATTER.format(release.getPublishTime().toInstant()));
        }
        return objectMapper.writeValueAsString(root);
    }

    private record Target(String platform, String arch) {
    }
}
