package com.iwhalecloud.byai.gateway.sandbox.platform;

import com.iwhalecloud.byai.common.storage.ObjectStorage;
import com.iwhalecloud.byai.common.storage.model.*;
import java.io.*;
import java.util.*;
import org.springframework.beans.factory.ObjectProvider;

/** 单次调用固定执行侧；流式下载的返回对象拥有HTTP响应，调用方关闭后释放连接。 */
public final class PlatformRoutedStorage implements ObjectStorage {
    private final java.util.function.Supplier<String> storageType;
    private final ObjectStorage legacy;
    private final PlatformRemoteGateway gateway;
    private final ObjectProvider<PlatformStorageClient> files;

    public PlatformRoutedStorage(
            ObjectStorage legacy,
            PlatformRemoteGateway gateway,
            ObjectProvider<PlatformStorageClient> files) {
        this(legacy, gateway, files, null);
    }

    public PlatformRoutedStorage(
            ObjectStorage legacy,
            PlatformRemoteGateway gateway,
            ObjectProvider<PlatformStorageClient> files,
            java.util.function.Supplier<String> storageType) {
        this.storageType = storageType;
        this.legacy = legacy;
        this.gateway = gateway;
        this.files = files;
    }

    private boolean remote() {
        return gateway.isRemote()
                && (storageType == null
                        || com.iwhalecloud.byai.common.storage.constants.StorageType
                                .isLocalFilesystem(storageType.get()));
    }

    private Map<String, Object> location(StorageLocation value) {
        return gateway.params(
                "namespace",
                value.getNamespace(),
                "bucketOrRoot",
                value.getBucketOrRoot(),
                "path",
                value.getPath(),
                "shareType",
                value.getShareType());
    }

    private Map<String, Object> prefix(StoragePrefix value) {
        return gateway.params(
                "namespace",
                value.getNamespace(),
                "bucketOrRoot",
                value.getBucketOrRoot(),
                "prefix",
                value.getPrefix(),
                "shareType",
                value.getShareType(),
                "recursive",
                value.isRecursive());
    }

    public void init(String root) {
        if (!remote()) {
            legacy.init(root);
            return;
        }
        gateway.call("storage", "init", gateway.params("bucketOrRoot", root));
    }

    public void mount(String root) {
        if (!remote()) {
            legacy.mount(root);
            return;
        }
        gateway.call("storage", "mount", gateway.params("bucketOrRoot", root));
    }

    public FileMetadata put(StorageLocation value, InputStream input, long size, String type) {
        if (!remote()) return legacy.put(value, input, size, type);
        Map<String, Object> query = location(value);
        query.put("size", size);
        String contentType = type == null ? "application/octet-stream" : type;
        return gateway.convert(
                gateway.data(
                        gateway.safe(
                                () ->
                                        PlatformStreamingClient.withUpload(
                                                input,
                                                size,
                                                contentType,
                                                () ->
                                                        files.getObject()
                                                                .put(
                                                                        query,
                                                                        contentType,
                                                                        Collections.emptyMap())))),
                FileMetadata.class);
    }

    public InputStream get(StorageLocation value) {
        if (!remote()) return legacy.get(value);
        feign.Response response = gateway.safe(() -> files.getObject().get(location(value)));
        if (response.status() < 200 || response.status() >= 300 || response.body() == null) {
            response.close();
            throw new com.iwhalecloud.byai.state.common.exception.BdpRuntimeException(
                    "Platform file download failed");
        }
        try {
            return new FilterInputStream(response.body().asInputStream()) {
                private boolean closed;

                public void close() {
                    if (!closed) {
                        closed = true;
                        response.close();
                    }
                }
            };
        } catch (IOException failure) {
            response.close();
            throw new com.iwhalecloud.byai.state.common.exception.BdpRuntimeException(
                    "Platform file download failed");
        }
    }

    public FileMetadata metadata(StorageLocation value) {
        return remote()
                ? gateway.convert(
                        gateway.call("storage", "metadata", location(value)), FileMetadata.class)
                : legacy.metadata(value);
    }

    public boolean exists(StorageLocation value) {
        return remote()
                ? Boolean.TRUE.equals(gateway.call("storage", "exists", location(value)))
                : legacy.exists(value);
    }

    public List<StorageObject> list(StoragePrefix value, Integer depth) {
        if (!remote()) return legacy.list(value, depth);
        Map<String, Object> request = prefix(value);
        request.put("maxDepth", depth);
        Object result = gateway.call("storage", "list", request);
        List<StorageObject> entries = new ArrayList<>();
        for (Object row : (List<?>) result) {
            Map<?, ?> object = (Map<?, ?>) row;
            entries.add(
                    StorageObject.builder()
                            .bucketOrRoot(Objects.toString(object.get("bucketOrRoot"), null))
                            .path(Objects.toString(object.get("path"), null))
                            .size(
                                    object.get("size") == null
                                            ? null
                                            : Long.valueOf(object.get("size").toString()))
                            .contentType(Objects.toString(object.get("contentType"), null))
                            .lastModified(Objects.toString(object.get("lastModified"), null))
                            .isDir(
                                    Boolean.TRUE.equals(object.get("dir"))
                                            || Boolean.TRUE.equals(object.get("isDir")))
                            .build());
        }
        return entries;
    }

    public void delete(StorageLocation value) {
        if (!remote()) {
            legacy.delete(value);
            return;
        }
        gateway.call("storage", "delete", location(value));
    }

    public void deletePrefix(StoragePrefix value) {
        if (!remote()) {
            legacy.deletePrefix(value);
            return;
        }
        gateway.call("storage", "delete-prefix", prefix(value));
    }

    public void copy(StorageLocation source, StorageLocation target) {
        if (!remote()) {
            legacy.copy(source, target);
            return;
        }
        gateway.call(
                "storage",
                "copy",
                gateway.params("source", location(source), "target", location(target)));
    }

    public void move(StorageLocation source, StorageLocation target) {
        if (!remote()) {
            legacy.move(source, target);
            return;
        }
        gateway.call(
                "storage",
                "move",
                gateway.params("source", location(source), "target", location(target)));
    }
}
