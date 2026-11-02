package com.iwhalecloud.byai.state.application.service.filebrowser;

import com.iwhalecloud.byai.common.storage.constants.StorageType;
import com.iwhalecloud.byai.common.storage.util.UserBucketNameResolver;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformStorageClient;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformStreamingClient;
import com.iwhalecloud.byai.state.application.service.upload.GlobalFileUploadValidator;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/** Authenticated business boundary for the platform's general resumable storage API. */
@Service
public class FileBrowserTransferApplicationService {
    public record UploadRequest(Long resourceId, String path, String fileName, String uploadId,
                                Long totalSize, String sha256, String contentType, Boolean overwrite) {
        public UploadRequest(Long resourceId, String path, String fileName, String uploadId,
                Long totalSize, String sha256, String contentType) {
            this(resourceId, path, fileName, uploadId, totalSize, sha256, contentType, false);
        }
    }
    private static final long MAX_CHUNK_SIZE = 16L * 1024 * 1024;
    private final PlatformRemoteGateway gateway;
    private final ObjectProvider<PlatformStorageClient> clients;
    private final GlobalFileUploadValidator validator;
    private final String storageType;

    public FileBrowserTransferApplicationService(PlatformRemoteGateway gateway,
            ObjectProvider<PlatformStorageClient> clients, GlobalFileUploadValidator validator,
            @Value("${file.storage.type:file}") String storageType) {
        this.gateway = gateway;
        this.clients = clients;
        this.validator = validator;
        this.storageType = storageType;
    }

    public boolean enabled() {
        return gateway.isRemote() && StorageType.isLocalFilesystem(storageType);
    }

    public Map<String, Object> capabilities() {
        if (!enabled()) return Map.of("resumable", false);
        var policy = effectivePolicy();
        if (policy == null) return Map.of("resumable", false);
        return Map.of("resumable", true, "maxSize", policy.maxSize(), "chunkSize", policy.chunkSize());
    }

    private com.iwhalecloud.byai.state.application.service.upload.ResumableUploadPolicy effectivePolicy() {
        Object value = gateway.data(gateway.safe(() -> {
            try {
                return clients.getObject().uploadCapabilities();
            } catch (feign.FeignException failure) {
                // Older platforms expose only the existing multipart storage API.
                if (failure.status() == 404) return Map.of("code", 0, "data", Map.of("resumable", false));
                throw failure;
            }
        }));
        if (value instanceof Map<?, ?> details && Boolean.FALSE.equals(details.get("resumable"))) return null;
        if (!(value instanceof Map<?, ?> details) || !(details.get("maxSize") instanceof Number max)
                || max.longValue() <= 0 || !(details.get("chunkSize") instanceof Number chunk)) {
            throw new IllegalStateException("Invalid platform upload capability response");
        }
        long minimum = details.get("minChunkSize") instanceof Number n ? n.longValue() : 1024L * 1024;
        long maximum = details.get("maxChunkSize") instanceof Number n ? n.longValue() : chunk.longValue();
        long maxChunks = details.get("maxChunks") instanceof Number n ? n.longValue() : 1024;
        maximum = Math.min(MAX_CHUNK_SIZE, maximum);
        return validator.resumablePolicy().effective(max.longValue(), minimum, maximum, maxChunks);
    }

    public Object control(String userCode, String operation, UploadRequest request) {
        if (!Set.of("create", "status", "complete", "abort").contains(operation)) {
            throw new IllegalArgumentException("Unsupported upload operation");
        }
        Map<String, Object> target = target(userCode, request);
        if ("create".equals(operation)) {
            if (request.totalSize() == null || request.totalSize() < 0 || request.sha256() == null
                    || !request.sha256().matches("[a-fA-F0-9]{64}")) {
                throw new IllegalArgumentException("Invalid upload size or SHA-256");
            }
            Object prior = gateway.call("storage", "uploads/status", new LinkedHashMap<>(target));
            String priorState = prior instanceof Map<?, ?> p ? String.valueOf(p.get("state")) : "INVALID";
            if ("EXPIRED".equals(priorState)) return prior;
            boolean existing = Set.of("UPLOADING", "COMPLETED").contains(priorState);
            if (existing) {
                Map<?, ?> saved = (Map<?, ?>) prior;
                if (!(saved.get("totalSize") instanceof Number size) || size.longValue() != request.totalSize()
                        || !request.sha256().equalsIgnoreCase(String.valueOf(saved.get("sha256")))) {
                    throw new IllegalArgumentException("Upload identity is already bound to different contents");
                }
            } else {
                if (!"NOT_FOUND".equals(priorState)) throw new IllegalStateException("Invalid upload status response");
                var policy = effectivePolicy();
                if (policy == null) throw new IllegalStateException("Platform resumable uploads are unavailable");
                validator.validateSize(request.totalSize());
                if (request.totalSize() > policy.maxSize()) throw new IllegalArgumentException("Upload exceeds current system maximum");
                gateway.checkPersonalQuota("UPLOAD", request.totalSize());
                target.put("maxSize", policy.maxSize());
                target.put("chunkSize", policy.chunkSize());
            }
            // Existing sessions validate immutable bindings remotely, without reapplying new-upload policy.
            target.put("overwrite", Boolean.TRUE.equals(request.overwrite()));
            target.put("totalSize", request.totalSize());
            target.put("sha256", request.sha256().toLowerCase(java.util.Locale.ROOT));
            target.put("contentType", StringUtils.defaultIfBlank(request.contentType(), "application/octet-stream"));
        }
        return gateway.call("storage", "uploads/" + operation, target);
    }

    public Object chunk(String userCode, UploadRequest request, int index, String sha256, MultipartFile chunk)
            throws IOException {
        Map<String, Object> target = target(userCode, request);
        if (index < 0 || chunk == null || chunk.getSize() <= 0 || chunk.getSize() > MAX_CHUNK_SIZE
                || sha256 == null || !sha256.matches("[a-fA-F0-9]{64}")) {
            throw new IllegalArgumentException("Invalid upload chunk");
        }
        target.put("index", index);
        target.put("size", chunk.getSize());
        target.put("sha256", sha256);
        try (var input = chunk.getInputStream()) {
            return gateway.data(gateway.safe(() -> PlatformStreamingClient.withUpload(input, chunk.getSize(),
                "application/octet-stream", () -> clients.getObject().uploadChunk(target,
                    "application/octet-stream", Map.of()))));
        }
    }

    public feign.Response download(String userCode, Long resourceId, String path, String range, String ifRange) {
        if (StringUtils.isBlank(userCode) || resourceId == null || resourceId <= 0) {
            throw new IllegalArgumentException("Authentication required");
        }
        if (!enabled()) throw new IllegalStateException("Platform filesystem storage required");
        FileBrowserPathPolicy.assertBrowsable(path);
        String normalized = FileBrowserPathPolicy.normalize(path);
        if (!normalized.startsWith("/by/")) normalized = "/by" + normalized;
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("namespace", "workspace");
        params.put("bucketOrRoot", UserBucketNameResolver.buildUserBucketName(userCode));
        params.put("shareType", "private");
        params.put("path", normalized);
        return gateway.safe(() -> clients.getObject().getRange(params, range, ifRange));
    }

    private Map<String, Object> target(String userCode, UploadRequest request) {
        if (StringUtils.isBlank(userCode)) throw new IllegalArgumentException("Authentication required");
        if (!enabled()) throw new IllegalStateException("Resumable transfers require platform filesystem storage");
        if (request == null || request.resourceId() == null || request.resourceId() <= 0
                || StringUtils.isBlank(request.fileName()) || request.fileName().contains("/")
                || request.fileName().contains("\\") || request.fileName().contains("..")
                || request.fileName().indexOf('\0') >= 0) {
            throw new IllegalArgumentException("Invalid upload target");
        }
        // ZIP uploads retain the existing skill inspection/registration transaction.
        if (request.fileName().toLowerCase(java.util.Locale.ROOT).endsWith(".zip")) {
            throw new IllegalArgumentException("ZIP uploads require the skill-aware upload endpoint");
        }
        UUID.fromString(request.uploadId());
        String directory = FileBrowserPathPolicy.normalize(request.path());
        FileBrowserPathPolicy.assertBrowsable(directory);
        String path = ("/".equals(directory) ? "" : directory) + "/" + request.fileName();
        FileBrowserPathPolicy.assertNoProtectedIntersection(path);
        if (!path.startsWith("/by/")) path = "/by" + path;
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("namespace", "workspace");
        params.put("bucketOrRoot", UserBucketNameResolver.buildUserBucketName(userCode));
        params.put("shareType", "private");
        params.put("path", path);
        params.put("ownerKey", "workspace:user:" + userCode);
        params.put("uploadId", request.uploadId());
        return params;
    }
}
