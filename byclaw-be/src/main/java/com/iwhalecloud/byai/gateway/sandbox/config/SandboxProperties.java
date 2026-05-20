package com.iwhalecloud.byai.gateway.sandbox.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

import com.iwhalecloud.byai.common.storage.constants.StorageType;
import lombok.Data;

import java.util.Map;

@Data
@ConfigurationProperties(prefix = "byclaw.sandbox")
public class SandboxProperties {

    private OpenSandboxConfig opensandbox = new OpenSandboxConfig();

    /**
     * Redis metadata cache TTL. DB remains the lifecycle source of truth.
     */
    private Duration metadataCacheTtl = Duration.ofMinutes(10);

    /**
     * 创建沙箱时轮询状态的间隔
     */
    private Duration pollInterval = Duration.ofSeconds(2);

    /**
     * 创建沙箱时轮询状态的超时时间
     */
    private Duration pollTimeout = Duration.ofSeconds(60);

    /**
     * 创建沙箱分布式锁 TTL（覆盖 OpenSandbox 创建 + 拉取 endpoints；进程崩溃时由 TTL 自动过期）
     */
    private Duration sandboxCreationLockTtl = Duration.ofSeconds(120);

    /**
     * Sandbox filesystem storage mode. Value must match a StorageType constant (e.g. minio, sftp, ftp).
     * When blank, uses @Primary FileStorageRouter.
     */
    private String storageMode = StorageType.SFTP;

    /**
     * Base path hint used by sandbox workspace-related configuration.
     * Example: /data/byai/openclaw
     */
    private String basePath;

    @Data
    public static class OpenSandboxConfig {
        private String baseUrl;
        private String apiKey;

        /**
         * When OpenSandbox endpoint (returned from /endpoints/{port}) is not a full URL,
         * we will prefix it with this scheme when polling.
         */
        private String endpointScheme = "http";

        /**
         * Base URL for UIAgent proxy endpoints, e.g. https://host:8443/sandboxes.
         */
        private String uiAgentProxyBaseUrl;

        /**
         * 创建前是否调用列表接口，按 userCode、serviceKey 与已有沙箱对齐（与创建请求 metadata 中字段一致）。
         */
        private boolean listSandboxesBeforeCreate = true;

        /**
         * 列表接口路径（相对 baseUrl），默认 GET /v1/sandboxes?userCode=&serviceKey=
         */
        private String listSandboxesPath = "/v1/sandboxes";

        private String listQueryUserCodeParam = "userCode";

        private String listQueryServiceKeyParam = "serviceKey";

        /**
         * 是否在 POST /v1/sandboxes 上携带 Idempotency-Key 请求头（与 metadata 中的 idempotencyKey 对应）。
         */
        private boolean sendIdempotencyKeyHeader = true;
    }
}
