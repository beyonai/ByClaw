package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLaunchRouting;

@Component
@ConfigurationProperties(prefix = "sandbox.cron-prewarm")
public class SandboxCronPrewarmProperties {

    private boolean enabled;

    private long lookaheadMs = 300_000L;

    private int maxUsersPerRun = 200;

    private int maxJobsPerUser = 50;

    private int maxLaunchesPerRun = 20;

    private String stateDir = "/.openclaw/state";

    private String sqliteFile = "openclaw.sqlite";

    private String defaultServiceKey = SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE;

    private String snapshotDir = "/tmp/byclaw-cron-prewarm-snapshots";

    private boolean snapshotRetainOnFailure;

    private int snapshotCopyRetry = 1;

    private long scanLockTtlSeconds = 300L;

    private String userCodes;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public long getLookaheadMs() {
        return lookaheadMs;
    }

    public void setLookaheadMs(long lookaheadMs) {
        this.lookaheadMs = lookaheadMs;
    }

    public int getMaxUsersPerRun() {
        return maxUsersPerRun;
    }

    public void setMaxUsersPerRun(int maxUsersPerRun) {
        this.maxUsersPerRun = maxUsersPerRun;
    }

    public int getMaxJobsPerUser() {
        return maxJobsPerUser;
    }

    public void setMaxJobsPerUser(int maxJobsPerUser) {
        this.maxJobsPerUser = maxJobsPerUser;
    }

    public int getMaxLaunchesPerRun() {
        return maxLaunchesPerRun;
    }

    public void setMaxLaunchesPerRun(int maxLaunchesPerRun) {
        this.maxLaunchesPerRun = maxLaunchesPerRun;
    }

    public String getStateDir() {
        return stateDir;
    }

    public void setStateDir(String stateDir) {
        this.stateDir = stateDir;
    }

    public String getSqliteFile() {
        return sqliteFile;
    }

    public void setSqliteFile(String sqliteFile) {
        this.sqliteFile = sqliteFile;
    }

    public String getDefaultServiceKey() {
        return defaultServiceKey;
    }

    public void setDefaultServiceKey(String defaultServiceKey) {
        this.defaultServiceKey = defaultServiceKey;
    }

    public String getSnapshotDir() {
        return snapshotDir;
    }

    public void setSnapshotDir(String snapshotDir) {
        this.snapshotDir = snapshotDir;
    }

    public boolean isSnapshotRetainOnFailure() {
        return snapshotRetainOnFailure;
    }

    public void setSnapshotRetainOnFailure(boolean snapshotRetainOnFailure) {
        this.snapshotRetainOnFailure = snapshotRetainOnFailure;
    }

    public int getSnapshotCopyRetry() {
        return snapshotCopyRetry;
    }

    public void setSnapshotCopyRetry(int snapshotCopyRetry) {
        this.snapshotCopyRetry = snapshotCopyRetry;
    }

    public long getScanLockTtlSeconds() {
        return scanLockTtlSeconds;
    }

    public void setScanLockTtlSeconds(long scanLockTtlSeconds) {
        this.scanLockTtlSeconds = scanLockTtlSeconds;
    }

    public String getUserCodes() {
        return userCodes;
    }

    public void setUserCodes(String userCodes) {
        this.userCodes = userCodes;
    }

    public int normalizedMaxUsersPerRun() {
        return Math.max(1, maxUsersPerRun);
    }

    public int normalizedMaxJobsPerUser() {
        return Math.max(1, maxJobsPerUser);
    }

    public int normalizedMaxLaunchesPerRun() {
        return Math.max(1, maxLaunchesPerRun);
    }

    public int normalizedSnapshotCopyRetry() {
        return Math.max(1, snapshotCopyRetry);
    }

    public long normalizedScanLockTtlSeconds() {
        return Math.max(1L, scanLockTtlSeconds);
    }
}
