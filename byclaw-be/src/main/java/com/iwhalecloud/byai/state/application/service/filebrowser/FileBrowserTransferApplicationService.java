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
        Map<?,?> details=capabilityDetails();
        if(Boolean.FALSE.equals(details.get("resumable")))return Map.of("resumable",false);
        var policy = effectivePolicy(details);
        return Map.of("resumable", true, "maxSize", policy.maxSize(), "chunkSize", policy.chunkSize());
    }

    public boolean supportsRange() {
        if(!enabled())return false;
        Object supported=capabilityDetails().get("range");
        if(!(supported instanceof Boolean))throw new IllegalStateException("Invalid platform range capability response");
        return Boolean.TRUE.equals(supported);
    }

    private Map<?,?> capabilityDetails() {
        return capabilityDetails(com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.getCurrentUserCode());
    }
    private Map<?,?> capabilityDetails(String userCode) {
        // Never share a cached capability between users with different durable backends.
        Object value=gateway.data(gateway.safe(()->StringUtils.isBlank(userCode)?clients.getObject().uploadCapabilities():clients.getObject().uploadCapabilitiesFor(
            Map.of("namespace","workspace","bucketOrRoot",UserBucketNameResolver.buildUserBucketName(userCode),"shareType","private"))));
        if(!(value instanceof Map<?,?> details)||!(details.get("resumable") instanceof Boolean))
            throw new IllegalStateException("Invalid platform upload capability response");
        return details;
    }

    private com.iwhalecloud.byai.state.application.service.upload.ResumableUploadPolicy effectivePolicy(String userCode) {
        return effectivePolicy(capabilityDetails(userCode));
    }
    private com.iwhalecloud.byai.state.application.service.upload.ResumableUploadPolicy effectivePolicy(Map<?,?> details) {
        if (!Boolean.TRUE.equals(details.get("resumable")) || !(details.get("maxSize") instanceof Number max)
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
                var policy = effectivePolicy(userCode);
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

    public Object unfinished(String userCode, Long resourceId) {
        if(StringUtils.isBlank(userCode)||resourceId==null||resourceId<=0)
            throw new IllegalArgumentException("Authentication required");
        if(!enabled())throw new IllegalStateException("Resumable transfers require platform filesystem storage");
        Map<String,Object> target=new LinkedHashMap<>();
        target.put("namespace","workspace");target.put("bucketOrRoot",UserBucketNameResolver.buildUserBucketName(userCode));
        target.put("shareType","private");target.put("path","/by");target.put("ownerKey","workspace:user:"+userCode);
        Object response=gateway.call("storage","uploads/list",target);
        if(!(response instanceof Map<?,?> result)||!(result.get("uploads") instanceof java.util.List<?> entries)||entries.size()>1024)
            throw new IllegalStateException("Invalid unfinished upload response");
        java.util.List<Map<String,Object>> visible=new java.util.ArrayList<>();
        for(Object value:entries) {
            if(!(value instanceof Map<?,?> saved)||!(saved.get("path") instanceof String stored))
                throw new IllegalStateException("Invalid unfinished upload entry");
            String normalized=FileBrowserPathPolicy.normalize(stored.startsWith("/")?stored:"/"+stored);
            if(!normalized.startsWith("/by/"))continue;
            int slash=normalized.lastIndexOf('/');String filename=normalized.substring(slash+1);
            String directory=normalized.substring(3,slash);if(directory.isEmpty())directory="/";
            String uploadId=String.valueOf(saved.get("uploadId"));
            // Reuse the exact status/abort authorization and protected-path checks before exposing identity.
            if(!matchesStoredUploadPath(userCode,resourceId,directory,filename,uploadId,normalized)) {
                // A real first directory named "by" is ambiguous with target's optional workspace prefix.
                directory=normalized.substring(0,slash);
                if(!matchesStoredUploadPath(userCode,resourceId,directory,filename,uploadId,normalized))continue;
            }
            Map<String,Object> entry=new LinkedHashMap<>();
            for(String field:java.util.List.of("uploadId","totalSize","state","phase","expiresAt","uploadedChunkCount","totalChunks"))
                if(saved.containsKey(field))entry.put(field,saved.get(field));
            entry.put("path",directory);entry.put("fileName",filename);visible.add(entry);
        }
        return Map.of("uploads",visible);
    }

    private boolean matchesStoredUploadPath(String userCode,Long resourceId,String directory,String filename,
            String uploadId,String storedPath) {
        try {
            return storedPath.equals(target(userCode,new UploadRequest(resourceId,directory,filename,uploadId,null,null,null)).get("path"));
        }catch(IllegalArgumentException inaccessible){return false;}
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
