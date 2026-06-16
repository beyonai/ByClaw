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
import java.util.zip.ZipEntry;
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
            String path = resolvePath(relativePath);
            HttpUrl targetUrl = buildTargetUrl(userCode, API_PREFIX + "/list", "path=" + encode(path));
            Request request = new Request.Builder().url(targetUrl).get().build();
            String body = executeForString(request);
            return parseItemList(body);
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
        try {
            Response response = httpClient.newCall(request).execute();
            if (!response.isSuccessful() || response.body() == null) {
                if (response.body() != null) response.body().close();
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
        String lowerKeyword = keyword.toLowerCase();
        List<FileBrowserItemVo> result = new ArrayList<>();
        for (FileBrowserItemVo item : allItems) {
            if (item.getName().toLowerCase().contains(lowerKeyword)) {
                result.add(item);
            }
        }
        return result;
    }

    @Override
    public void downloadFolder(String userCode, Long resourceId, String relativePath, OutputStream outputStream) throws IOException {
        List<FileBrowserItemVo> items = list(userCode, resourceId, relativePath);
        if (items.isEmpty()) {
            return;
        }

        try (ZipOutputStream zos = new ZipOutputStream(outputStream)) {
            byte[] buffer = new byte[8192];
            for (FileBrowserItemVo item : items) {
                if (item.isDir()) {
                    continue;
                }
                try {
                    zos.putNextEntry(new ZipEntry(item.getName()));
                    try (InputStream in = download(userCode, resourceId, item.getPath())) {
                        int len;
                        while ((len = in.read(buffer)) > 0) {
                            zos.write(buffer, 0, len);
                        }
                    }
                    zos.closeEntry();
                } catch (Exception e) {
                    LOGGER.warn("OpenClaw文件夹下载-跳过文件: path={}, error={}", item.getPath(), e.getMessage());
                }
            }
        }
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
                return result;
            }
            for (JsonNode node : items) {
                FileBrowserItemVo vo = new FileBrowserItemVo();
                vo.setName(node.get("name").asText());
                vo.setPath(node.get("path").asText());
                vo.setDir(node.get("isDir").asBoolean());
                if (!vo.isDir()) {
                    vo.setSize(node.get("size").asLong());
                    long modified = node.get("modified").asLong();
                    vo.setLastModified(
                        Instant.ofEpochMilli(modified)
                            .atOffset(ZoneOffset.UTC)
                            .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
                    );
                }
                result.add(vo);
            }
        } catch (Exception e) {
            LOGGER.error("解析OpenClaw响应失败", e);
        }
        return result;
    }
}
