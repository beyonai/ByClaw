package com.iwhalecloud.byai.state.application.service.filebrowser;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.ChangedFileDiffVo;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;

@Service
public class FileBrowserApplicationService {

    private static final String DEFAULT_WORKSPACE_TEMPLATE = ".openclaw/workspace-baiying-agent-%s/";

    private static final String RESOURCE_SKILL_ROOT = "/byclaw/resource/skill";

    private static final String FILE_CHANGE_PATH_TEMPLATE = "/by/.file_changes/%s/files/%s.json";

    private static final String SAFE_PATH_SEGMENT_PATTERN = "[A-Za-z0-9_-]+";

    private final FileBrowserProviderFactory providerFactory;

    private final ByClawSkillResourceApplicationService byClawSkillResourceApplicationService;

    private final UserFS userFS;

    private final ObjectMapper objectMapper;

    public FileBrowserApplicationService(FileBrowserProviderFactory providerFactory,
        ByClawSkillResourceApplicationService byClawSkillResourceApplicationService, UserFS userFS,
        ObjectMapper objectMapper) {
        this.providerFactory = providerFactory;
        this.byClawSkillResourceApplicationService = byClawSkillResourceApplicationService;
        this.userFS = userFS;
        this.objectMapper = objectMapper;
    }

    public String getDefaultPath(Long resourceId) {
        return "/" + String.format(DEFAULT_WORKSPACE_TEMPLATE, resourceId);
    }

    public List<FileBrowserItemVo> list(String userCode, Long resourceId, String relativePath) {
        FileBrowserPathPolicy.assertBrowsable(relativePath);
        return providerFactory.getProvider().list(userCode, resourceId, toProviderPath(relativePath)).stream()
            .filter(item -> !FileBrowserPathPolicy.isProtected(item.getPath()))
            .map(this::toExternalItem)
            .toList();
    }

    public void upload(String userCode, Long resourceId, String relativePath, MultipartFile[] files) throws Exception {
        FileBrowserPathPolicy.assertBrowsable(relativePath);
        String providerPath = toProviderPath(relativePath);
        if (files != null) {
            for (MultipartFile file : files) {
                if (file != null) {
                    FileBrowserPathPolicy.assertNoProtectedIntersection(
                        resolveChildPath(relativePath, file.getOriginalFilename()));
                }
            }
        }
        providerFactory.getProvider().upload(userCode, resourceId, providerPath, files);
        byClawSkillResourceApplicationService.registerFileManagedSkills(userCode, resourceId, providerPath,
            files == null ? java.util.Collections.emptyList() : java.util.Arrays.asList(files));
    }

    public InputStream download(String userCode, Long resourceId, String relativePath) {
        FileBrowserPathPolicy.assertBrowsable(relativePath);
        return providerFactory.getProvider().download(userCode, resourceId, toProviderPath(relativePath));
    }

    /**
     * 从当前登录用户的个人桶读取指定会话的文件变更快照。
     */
    public ChangedFileDiffVo getChangedFileDiff(String sessionId, String uuid) {
        validatePathSegment("sessionId", sessionId);
        validatePathSegment("uuid", uuid);
        String path = FILE_CHANGE_PATH_TEMPLATE.formatted(sessionId, uuid);
        try (InputStream inputStream = userFS.read(path)) {
            if (inputStream == null) {
                throw new IllegalStateException("文件变更详情不存在");
            }
            ChangedFileDiffVo diff = objectMapper.readValue(inputStream, ChangedFileDiffVo.class);
            if (!sessionId.equals(diff.getSessionId()) || !uuid.equals(diff.getUuid())) {
                throw new IllegalStateException("文件变更详情与请求参数不匹配");
            }
            return diff;
        }
        catch (IOException e) {
            throw new IllegalStateException("读取文件变更详情失败", e);
        }
    }

    public void delete(String userCode, Long resourceId, List<String> relativePaths) {
        assertNotResourceManagedPath(relativePaths);
        assertNoProtectedIntersection(relativePaths);
        providerFactory.getProvider().delete(userCode, resourceId, toProviderPaths(relativePaths));
    }

    public void rename(String userCode, Long resourceId, String sourcePath, String newName) {
        assertNotResourceManagedPath(List.of(sourcePath));
        FileBrowserPathPolicy.assertNoProtectedIntersection(sourcePath);
        FileBrowserPathPolicy.assertBrowsable(resolveSiblingPath(sourcePath, newName));
        providerFactory.getProvider().rename(userCode, resourceId, toProviderPath(sourcePath), newName);
    }

    public void move(String userCode, Long resourceId, List<String> sourcePaths, String targetDirectory) {
        assertNotResourceManagedPath(sourcePaths);
        assertNotResourceManagedPath(List.of(targetDirectory));
        assertNoProtectedIntersection(sourcePaths);
        FileBrowserPathPolicy.assertBrowsable(targetDirectory);
        for (String sourcePath : sourcePaths) {
            FileBrowserPathPolicy.assertNoProtectedIntersection(
                resolveChildPath(targetDirectory, fileName(sourcePath)));
        }
        providerFactory.getProvider().move(userCode, resourceId, toProviderPaths(sourcePaths), toProviderPath(targetDirectory));
    }

    public void copy(String userCode, Long resourceId, String sourcePath, String targetDirectory) {
        FileBrowserPathPolicy.assertNoProtectedIntersection(sourcePath);
        FileBrowserPathPolicy.assertBrowsable(targetDirectory);
        FileBrowserPathPolicy.assertNoProtectedIntersection(
            resolveChildPath(targetDirectory, fileName(sourcePath)));
        FileBrowserProvider provider = providerFactory.getProvider();
        ensureFolder(userCode, resourceId, targetDirectory);
        provider.copy(userCode, resourceId, toProviderPath(sourcePath), toProviderPath(targetDirectory));
    }

    public void createFolder(String userCode, Long resourceId, String relativePath) {
        FileBrowserPathPolicy.assertBrowsable(relativePath);
        providerFactory.getProvider().createFolder(userCode, resourceId, toProviderPath(relativePath));
    }

    /**
     * 幂等确保文件夹存在。按层级逐级创建，避免 .shared/.log 这类系统目录因父目录缺失而创建失败。
     */
    public void ensureFolder(String userCode, Long resourceId, String relativePath) {
        FileBrowserPathPolicy.assertBrowsable(relativePath);
        String normalizedPath = normalizeDirPath(toProviderPath(relativePath));
        if ("/".equals(normalizedPath)) {
            return;
        }
        FileBrowserProvider provider = providerFactory.getProvider();
        String parentPath = "/";
        for (String folderName : splitPath(normalizedPath)) {
            String targetPath = parentPath + folderName + "/";
            if (!folderExists(provider, userCode, resourceId, parentPath, folderName)) {
                try {
                    provider.createFolder(userCode, resourceId, targetPath);
                }
                catch (Exception e) {
                    if (!folderExists(provider, userCode, resourceId, parentPath, folderName)) {
                        throw e;
                    }
                }
            }
            parentPath = targetPath;
        }
    }

    public List<FileBrowserItemVo> search(String userCode, Long resourceId, String relativePath, String keyword) {
        FileBrowserPathPolicy.assertBrowsable(relativePath);
        return providerFactory.getProvider().search(userCode, resourceId, toProviderPath(relativePath), keyword).stream()
            .filter(item -> !FileBrowserPathPolicy.isProtected(item.getPath()))
            .map(this::toExternalItem)
            .toList();
    }

    public void downloadFolder(String userCode, Long resourceId, String relativePath, OutputStream outputStream) throws IOException {
        FileBrowserPathPolicy.assertNoProtectedIntersection(relativePath);
        providerFactory.getProvider().downloadFolder(userCode, resourceId, toProviderPath(relativePath), outputStream);
    }

    public String getFolderName(String relativePath) {
        String path = relativePath.endsWith("/") ? relativePath.substring(0, relativePath.length() - 1) : relativePath;
        int lastSlash = path.lastIndexOf('/');
        String name = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
        return StringUtils.isBlank(name) ? "download" : name;
    }

    private boolean folderExists(FileBrowserProvider provider, String userCode, Long resourceId, String parentPath,
        String folderName) {
        return provider.list(userCode, resourceId, parentPath).stream()
            .anyMatch(item -> item.isDir() && folderName.equals(item.getName()));
    }

    private List<String> splitPath(String path) {
        String normalizedPath = StringUtils.strip(path, "/");
        if (StringUtils.isBlank(normalizedPath)) {
            return List.of();
        }
        List<String> result = new ArrayList<>();
        for (String segment : normalizedPath.split("/")) {
            if (StringUtils.isNotBlank(segment)) {
                result.add(segment);
            }
        }
        return result;
    }

    private String normalizeDirPath(String path) {
        String normalizedPath = StringUtils.defaultIfBlank(path, "/").trim().replace('\\', '/').replaceAll("/+", "/");
        if (StringUtils.contains(normalizedPath, "..")) {
            throw new IllegalArgumentException("非法路径: " + path);
        }
        if (!normalizedPath.startsWith("/")) {
            normalizedPath = "/" + normalizedPath;
        }
        return normalizedPath.endsWith("/") ? normalizedPath : normalizedPath + "/";
    }

    private void assertNotResourceManagedPath(List<String> paths) {
        if (paths == null) {
            return;
        }
        for (String path : paths) {
            String normalizedPath = normalizePath(path);
            if (isResourceManagedSkillPath(normalizedPath)) {
                throw new IllegalArgumentException(I18nUtil.get("byclaw.filebrowser.resource.managed.readonly",
                    normalizedPath));
            }
        }
    }

    private void assertNoProtectedIntersection(List<String> paths) {
        if (paths != null) {
            paths.forEach(FileBrowserPathPolicy::assertNoProtectedIntersection);
        }
    }

    private String resolveSiblingPath(String sourcePath, String newName) {
        String normalizedSource = FileBrowserPathPolicy.normalize(sourcePath);
        int slash = normalizedSource.lastIndexOf('/');
        String parent = slash <= 0 ? "" : normalizedSource.substring(0, slash);
        return resolveChildPath(parent, newName);
    }

    private String resolveChildPath(String parentPath, String childName) {
        if (StringUtils.isBlank(childName) || childName.contains("/") || childName.contains("\\")
                || childName.contains("..")) {
            throw new IllegalArgumentException("非法文件名: " + childName);
        }
        String parent = FileBrowserPathPolicy.normalize(parentPath);
        return "/".equals(parent) ? "/" + childName : parent + "/" + childName;
    }

    private String fileName(String path) {
        String normalized = FileBrowserPathPolicy.normalize(path);
        int slash = normalized.lastIndexOf('/');
        return normalized.substring(slash + 1);
    }

    private boolean isResourceManagedSkillPath(String normalizedPath) {
        return RESOURCE_SKILL_ROOT.equals(normalizedPath) || normalizedPath.startsWith(RESOURCE_SKILL_ROOT + "/");
    }

    private String normalizePath(String path) {
        String normalizedPath = StringUtils.defaultIfBlank(path, "/").trim().replace('\\', '/').replaceAll("/+", "/");
        if (StringUtils.contains(normalizedPath, "..")) {
            throw new IllegalArgumentException("非法路径: " + path);
        }
        if (!normalizedPath.startsWith("/")) {
            normalizedPath = "/" + normalizedPath;
        }
        return StringUtils.removeEnd(normalizedPath, "/");
    }

    private void validatePathSegment(String name, String value) {
        if (StringUtils.isBlank(value) || !value.matches(SAFE_PATH_SEGMENT_PATTERN)) {
            throw new IllegalArgumentException(name + " is invalid");
        }
    }

    private String toProviderPath(String path) {
        String normalized = FileBrowserPathPolicy.normalize(path);
        if ("/by".equals(normalized)) return "/";
        return normalized.startsWith("/by/") ? normalized.substring(3) : normalized;
    }

    private List<String> toProviderPaths(List<String> paths) {
        return paths == null ? null : paths.stream().map(this::toProviderPath).toList();
    }

    private FileBrowserItemVo toExternalItem(FileBrowserItemVo item) {
        String path = FileBrowserPathPolicy.normalize(item.getPath());
        if ("/".equals(path)) return item;
        item.setPath(path.startsWith("/by/") ? path : "/by" + path);
        return item;
    }
}
