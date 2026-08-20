package com.iwhalecloud.byai.state.application.service.filebrowser;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipOutputStream;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressEndpointResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeResolver;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;

import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

@Component
public class OpenClawFileBrowserProvider implements FileBrowserProvider {

    private static final Logger LOGGER = LoggerFactory.getLogger(OpenClawFileBrowserProvider.class);
    private static final String FILEBROWSER_INSTANCE = "filebrowser";
    private static final String API_PREFIX = "/filebrowser/openclaw-api";
    private static final String ROOT_PREFIX = "/";

    private final SandboxIngressEndpointResolver endpointResolver;
    private final SandboxIngressRuntimeResolver runtimeResolver;
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;

    public OpenClawFileBrowserProvider(SandboxIngressEndpointResolver endpointResolver,
                                       SandboxIngressRuntimeResolver runtimeResolver,
                                       ObjectMapper objectMapper) {
        this.endpointResolver = endpointResolver;
        this.runtimeResolver = runtimeResolver;
        this.httpClient = new OkHttpClient.Builder()
            .connectTimeout(java.time.Duration.ofSeconds(30))
            .readTimeout(java.time.Duration.ofSeconds(120))
            .writeTimeout(java.time.Duration.ofSeconds(120))
            .build();
        this.objectMapper = objectMapper;
    }

    @Override
    public List<FileBrowserItemVo> list(String userCode, Long resourceId, String relativePath) {
        try {
            return requestItemList(userCode, relativePath);
        } catch (Exception e) {
            LOGGER.warn("OpenClaw文件列表获取失败: userCode={}, path={}, error={}", userCode, relativePath, e.getMessage());
            return new ArrayList<>();
        }
    }

    @Override
    public void upload(String userCode, Long resourceId, String relativePath, MultipartFile[] files) throws Exception {
        String path = resolvePath(relativePath);
        HttpUrl targetUrl;
        try {
            targetUrl = buildTargetUrl(userCode, API_PREFIX + "/upload", null);
        } catch (Exception e) {
            LOGGER.warn("OpenClaw文件上传失败（沙箱不可用）: userCode={}, error={}", userCode, e.getMessage());
            throw new RuntimeException("文件上传失败：沙箱环境不可用", e);
        }

        for (MultipartFile file : files) {
            if (file.isEmpty()) {
                continue;
            }
            String contentType = file.getContentType();
            if (contentType == null || contentType.isBlank()) {
                contentType = "application/octet-stream";
            }
            MultipartBody body = new MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("files", file.getOriginalFilename(),
                    RequestBody.create(file.getBytes(), MediaType.parse(contentType)))
                .addFormDataPart("path", path)
                .build();
            Request request = new Request.Builder().url(targetUrl).post(body).build();
            executeForString(request);
            LOGGER.info("OpenClaw文件上传成功: path={}, file={}", path, file.getOriginalFilename());
        }
    }

    @Override
    public InputStream download(String userCode, Long resourceId, String relativePath) {
        String path = resolvePath(relativePath);
        HttpUrl targetUrl;
        try {
            targetUrl = buildTargetUrl(userCode, API_PREFIX + "/download", "path=" + encode(path));
        } catch (Exception e) {
            LOGGER.warn("OpenClaw文件下载失败（沙箱不可用）: userCode={}, error={}", userCode, e.getMessage());
            throw new RuntimeException("文件下载失败：沙箱环境不可用", e);
        }
        Request request = new Request.Builder().url(targetUrl).get().build();
        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) {
                throw new RuntimeException("下载文件失败: " + path + ", status=" + response.code());
            }
            byte[] bytes = response.body().bytes();
            return new ByteArrayInputStream(bytes);
        } catch (IOException e) {
            throw new RuntimeException("文件下载失败: " + path, e);
        }
    }

    @Override
    public void delete(String userCode, Long resourceId, List<String> relativePaths) {
        for (String relativePath : relativePaths) {
            try {
                String path = resolvePath(relativePath);
                HttpUrl targetUrl = buildTargetUrl(userCode, API_PREFIX + "/delete", "path=" + encode(path));
                Request request = new Request.Builder().url(targetUrl).delete().build();
                executeForString(request);
                LOGGER.info("OpenClaw文件删除成功: path={}", path);
            } catch (Exception e) {
                LOGGER.warn("OpenClaw文件删除失败: userCode={}, path={}, error={}", userCode, relativePath, e.getMessage());
            }
        }
    }

    @Override
    public void rename(String userCode, Long resourceId, String sourcePath, String newName) {
        try {
            String path = resolvePath(sourcePath);
            HttpUrl targetUrl = buildTargetUrl(userCode, API_PREFIX + "/rename", null);
            String json = "{\"path\":\"" + path + "\",\"newName\":\"" + newName + "\"}";
            RequestBody body = RequestBody.create(json, MediaType.parse("application/json"));
            Request request = new Request.Builder().url(targetUrl).post(body).build();
            executeForString(request);
            LOGGER.info("OpenClaw文件重命名成功: path={}, newName={}", path, newName);
        } catch (Exception e) {
            LOGGER.warn("OpenClaw文件重命名失败: userCode={}, path={}, error={}", userCode, sourcePath, e.getMessage());
            throw new RuntimeException("文件重命名失败：沙箱环境不可用", e);
        }
    }

    @Override
    public void move(String userCode, Long resourceId, List<String> sourcePaths, String targetDirectory) {
        throw new UnsupportedOperationException("OpenClaw FileBrowser 暂不支持移动操作");
    }

    @Override
    public void copy(String userCode, Long resourceId, String sourcePath, String targetDirectory) {
        String normalizedTargetDirectory = ensureDirectoryPath(targetDirectory);
        if (sourcePath.endsWith("/")) {
            copyDirectory(userCode, resourceId, sourcePath, normalizedTargetDirectory);
        } else {
            copyFileToDirectory(userCode, resourceId, sourcePath, normalizedTargetDirectory);
        }
    }

    @Override
    public void createFolder(String userCode, Long resourceId, String relativePath) {
        try {
            String path = resolvePath(relativePath);
            HttpUrl targetUrl = buildTargetUrl(userCode, API_PREFIX + "/mkdir", null);

            if (path.endsWith("/")) {
                path = path.substring(0, path.length() - 1);
            }
            String parentPath = "/";
            String folderName = path;
            int lastSlash = path.lastIndexOf('/');
            if (lastSlash > 0) {
                parentPath = path.substring(0, lastSlash);
                folderName = path.substring(lastSlash + 1);
            } else if (lastSlash == 0) {
                parentPath = "/";
                folderName = path.substring(1);
            }

            String json = "{\"path\":\"" + parentPath + "\",\"name\":\"" + folderName + "\"}";
            RequestBody body = RequestBody.create(json, MediaType.parse("application/json"));
            Request request = new Request.Builder().url(targetUrl).post(body).build();
            executeForString(request);
            LOGGER.info("OpenClaw文件夹创建成功: path={}, name={}", parentPath, folderName);
        } catch (Exception e) {
            LOGGER.warn("OpenClaw文件夹创建失败: userCode={}, path={}, error={}", userCode, relativePath, e.getMessage());
            throw new RuntimeException("文件夹创建失败：沙箱环境不可用", e);
        }
    }

    @Override
    public List<FileBrowserItemVo> search(String userCode, Long resourceId, String relativePath, String keyword) {
        List<FileBrowserItemVo> allItems = list(userCode, resourceId, relativePath);
        List<FileBrowserItemVo> result = new ArrayList<>();
        for (FileBrowserItemVo item : allItems) {
            if (FileBrowserSearchMatcher.matches(item.getName(), item.getPath(), keyword)) {
                result.add(item);
            }
        }
        return result;
    }

    @Override
    public void downloadFolder(String userCode, Long resourceId, String relativePath, OutputStream outputStream) throws IOException {
        String rootPath = ensureDirectoryPath(relativePath);
        FileBrowserZipSupport.writeArchive(outputStream, zos -> {
            byte[] buffer = new byte[8192];
            writeZipEntries(userCode, resourceId, rootPath, requestItemList(userCode, rootPath), zos, buffer);
        });
    }

    private List<FileBrowserItemVo> requestItemList(String userCode, String relativePath) {
        String path = resolvePath(relativePath);
        HttpUrl targetUrl = buildTargetUrl(userCode, API_PREFIX + "/list", "path=" + encode(path));
        Request request = new Request.Builder().url(targetUrl).get().build();
        return parseItemList(executeForString(request));
    }

    private HttpUrl buildTargetUrl(String userCode, String apiPath, String queryString) {
        String endpoint = endpointResolver.resolveRequiredEndpoint(userCode, FILEBROWSER_INSTANCE);
        return runtimeResolver.resolve().buildTargetUrl(endpoint, apiPath, queryString);
    }

    private String executeForString(Request request) {
        try (Response response = httpClient.newCall(request).execute()) {
            String body = response.body() != null ? response.body().string() : "";
            if (!response.isSuccessful()) {
                throw new RuntimeException("OpenClaw请求失败: " + request.url() + ", status=" + response.code() + ", body=" + body);
            }
            return body;
        } catch (IOException e) {
            throw new RuntimeException("OpenClaw请求异常: " + request.url(), e);
        }
    }

    private String encode(String value) {
        try {
            return java.net.URLEncoder.encode(value, "UTF-8");
        } catch (Exception e) {
            return value;
        }
    }

    private String resolvePath(String relativePath) {
        if (relativePath == null || relativePath.isBlank() || "/".equals(relativePath)) {
            return ROOT_PREFIX;
        }
        if (relativePath.contains("..")) {
            throw new IllegalArgumentException("非法路径: " + relativePath);
        }
        String normalized = relativePath.trim().replace('\\', '/');
        normalized = ROOT_PREFIX + normalized.replaceFirst("^/+", "");
        if (!normalized.startsWith(ROOT_PREFIX)) {
            throw new IllegalArgumentException("非法路径: " + relativePath);
        }
        return normalized;
    }

    private List<FileBrowserItemVo> parseItemList(String json) {
        List<FileBrowserItemVo> result = new ArrayList<>();
        try {
            JsonNode root = objectMapper.readTree(json);
            JsonNode items = root.get("items");
            if (items == null || !items.isArray()) {
                throw new IllegalStateException("OpenClaw响应缺少items数组");
            }
            for (JsonNode node : items) {
                JsonNode name = node.get("name");
                JsonNode path = node.get("path");
                JsonNode isDir = node.get("isDir");
                if (name == null || path == null || isDir == null) {
                    throw new IllegalStateException("OpenClaw文件项字段不完整");
                }
                FileBrowserItemVo vo = new FileBrowserItemVo();
                vo.setName(name.asText());
                vo.setPath(path.asText());
                vo.setDir(isDir.asBoolean());
                if (!vo.isDir()) {
                    JsonNode size = node.get("size");
                    JsonNode modified = node.get("modified");
                    if (size == null || modified == null) {
                        throw new IllegalStateException("OpenClaw文件项缺少大小或修改时间");
                    }
                    vo.setSize(size.asLong());
                    vo.setLastModified(
                        Instant.ofEpochMilli(modified.asLong())
                            .atOffset(ZoneOffset.UTC)
                            .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
                    );
                }
                result.add(vo);
            }
        } catch (Exception e) {
            throw new IllegalStateException("解析OpenClaw响应失败", e);
        }
        return result;
    }

    private void copyDirectory(String userCode, Long resourceId, String sourcePath, String targetDirectory) {
        String normalizedSourcePath = ensureDirectoryPath(sourcePath);
        String dirName = extractName(normalizedSourcePath);
        String targetPath = ensureDirectoryPath(targetDirectory) + dirName + "/";
        if (targetPath.startsWith(normalizedSourcePath)) {
            throw new IllegalArgumentException("不能复制文件夹到自身或其子目录下");
        }
        createFolder(userCode, resourceId, targetPath);
        for (FileBrowserItemVo child : list(userCode, resourceId, normalizedSourcePath)) {
            if (child.isDir()) {
                copyDirectory(userCode, resourceId, child.getPath(), targetPath);
            } else {
                copyFileToDirectory(userCode, resourceId, child.getPath(), targetPath);
            }
        }
    }

    private void copyFileToDirectory(String userCode, Long resourceId, String sourcePath, String targetDirectory) {
        String targetPath = resolvePath(targetDirectory);
        HttpUrl targetUrl;
        try {
            targetUrl = buildTargetUrl(userCode, API_PREFIX + "/upload", null);
        } catch (Exception e) {
            throw new RuntimeException("文件复制失败：沙箱环境不可用", e);
        }

        try (InputStream inputStream = download(userCode, resourceId, sourcePath)) {
            byte[] bytes = inputStream.readAllBytes();
            MultipartBody body = new MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("files", extractName(sourcePath),
                    RequestBody.create(bytes, MediaType.parse("application/octet-stream")))
                .addFormDataPart("path", targetPath)
                .build();
            Request request = new Request.Builder().url(targetUrl).post(body).build();
            executeForString(request);
            LOGGER.info("OpenClaw文件复制成功: {} -> {}", sourcePath, targetDirectory);
        } catch (IOException e) {
            throw new RuntimeException("文件复制失败: " + sourcePath, e);
        }
    }

    private void writeZipEntries(String userCode, Long resourceId, String rootPath, List<FileBrowserItemVo> items,
        ZipOutputStream zos, byte[] buffer) throws IOException {
        for (FileBrowserItemVo item : items) {
            if (item.isDir()) {
                List<FileBrowserItemVo> children;
                try {
                    children = requestItemList(userCode, ensureDirectoryPath(item.getPath()));
                } catch (RuntimeException e) {
                    throw new IOException("获取文件夹内容失败: " + item.getPath(), e);
                }
                writeZipEntries(userCode, resourceId, rootPath, children, zos, buffer);
                continue;
            }
            String entryName = buildZipEntryName(rootPath, item.getPath());
            if (entryName.isEmpty()) {
                continue;
            }
            try (InputStream in = download(userCode, resourceId, item.getPath())) {
                FileBrowserZipSupport.writeEntry(zos, entryName, in, buffer, item.getSize());
            } catch (RuntimeException e) {
                throw new IOException("下载文件失败: " + item.getPath(), e);
            }
        }
    }

    private String buildZipEntryName(String rootPath, String itemPath) {
        String normalizedRoot = ensureDirectoryPath(rootPath);
        String normalizedItem = itemPath == null ? "" : itemPath.trim().replace('\\', '/').replaceAll("/+", "/");
        if (normalizedItem.startsWith(normalizedRoot)) {
            return normalizedItem.substring(normalizedRoot.length());
        }
        return extractName(normalizedItem);
    }

    private String ensureDirectoryPath(String path) {
        if (path == null || path.isBlank() || "/".equals(path)) {
            return "/";
        }
        String normalized = path.trim().replace('\\', '/').replaceAll("/+", "/");
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        return normalized.endsWith("/") ? normalized : normalized + "/";
    }

    private String extractName(String path) {
        String normalized = path == null ? "" : path.trim().replace('\\', '/');
        if (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        int lastSlash = normalized.lastIndexOf('/');
        return lastSlash >= 0 ? normalized.substring(lastSlash + 1) : normalized;
    }
}
