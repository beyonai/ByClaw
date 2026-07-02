package com.iwhalecloud.byai.state.application.service.filebrowser;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;

@Service
public class FileBrowserApplicationService {

    private static final String DEFAULT_WORKSPACE_TEMPLATE = ".openclaw/workspace-baiying-agent-%s/";

    private static final String RESOURCE_SKILL_ROOT = "/byclaw/resource/skill";

    private final FileBrowserProviderFactory providerFactory;

    private final ByClawSkillResourceApplicationService byClawSkillResourceApplicationService;

    public FileBrowserApplicationService(FileBrowserProviderFactory providerFactory,
        ByClawSkillResourceApplicationService byClawSkillResourceApplicationService) {
        this.providerFactory = providerFactory;
        this.byClawSkillResourceApplicationService = byClawSkillResourceApplicationService;
    }

    public String getDefaultPath(Long resourceId) {
        return "/" + String.format(DEFAULT_WORKSPACE_TEMPLATE, resourceId);
    }

    public List<FileBrowserItemVo> list(String userCode, Long resourceId, String relativePath) {
        return providerFactory.getProvider().list(userCode, resourceId, relativePath);
    }

    public void upload(String userCode, Long resourceId, String relativePath, MultipartFile[] files) throws Exception {
        providerFactory.getProvider().upload(userCode, resourceId, relativePath, files);
        byClawSkillResourceApplicationService.registerFileManagedSkills(userCode, resourceId, relativePath,
            files == null ? java.util.Collections.emptyList() : java.util.Arrays.asList(files));
    }

    public InputStream download(String userCode, Long resourceId, String relativePath) {
        return providerFactory.getProvider().download(userCode, resourceId, relativePath);
    }

    public void delete(String userCode, Long resourceId, List<String> relativePaths) {
        assertNotResourceManagedPath(relativePaths);
        providerFactory.getProvider().delete(userCode, resourceId, relativePaths);
    }

    public void rename(String userCode, Long resourceId, String sourcePath, String newName) {
        assertNotResourceManagedPath(List.of(sourcePath));
        providerFactory.getProvider().rename(userCode, resourceId, sourcePath, newName);
    }

    public void move(String userCode, Long resourceId, List<String> sourcePaths, String targetDirectory) {
        assertNotResourceManagedPath(sourcePaths);
        assertNotResourceManagedPath(List.of(targetDirectory));
        providerFactory.getProvider().move(userCode, resourceId, sourcePaths, targetDirectory);
    }

    public void copy(String userCode, Long resourceId, String sourcePath, String targetDirectory) {
        FileBrowserProvider provider = providerFactory.getProvider();
        ensureFolder(userCode, resourceId, targetDirectory);
        provider.copy(userCode, resourceId, sourcePath, targetDirectory);
    }

    public void createFolder(String userCode, Long resourceId, String relativePath) {
        providerFactory.getProvider().createFolder(userCode, resourceId, relativePath);
    }

    /**
     * 幂等确保文件夹存在。按层级逐级创建，避免 .shared/.log 这类系统目录因父目录缺失而创建失败。
     */
    public void ensureFolder(String userCode, Long resourceId, String relativePath) {
        String normalizedPath = normalizeDirPath(relativePath);
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
        return providerFactory.getProvider().search(userCode, resourceId, relativePath, keyword);
    }

    public void downloadFolder(String userCode, Long resourceId, String relativePath, OutputStream outputStream) throws IOException {
        providerFactory.getProvider().downloadFolder(userCode, resourceId, relativePath, outputStream);
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
}
