package com.iwhalecloud.byai.state.application.service.filebrowser;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;

@Service
public class FileBrowserApplicationService {

    private static final String DEFAULT_WORKSPACE_TEMPLATE = ".openclaw/workspace-baiying-agent-%s/";

    private final FileBrowserProviderFactory providerFactory;

    public FileBrowserApplicationService(FileBrowserProviderFactory providerFactory) {
        this.providerFactory = providerFactory;
    }

    public String getDefaultPath(Long resourceId) {
        return "/" + String.format(DEFAULT_WORKSPACE_TEMPLATE, resourceId);
    }

    public List<FileBrowserItemVo> list(String userCode, Long resourceId, String relativePath) {
        return providerFactory.getProvider().list(userCode, resourceId, relativePath);
    }

    public void upload(String userCode, Long resourceId, String relativePath, MultipartFile[] files) throws Exception {
        providerFactory.getProvider().upload(userCode, resourceId, relativePath, files);
    }

    public InputStream download(String userCode, Long resourceId, String relativePath) {
        return providerFactory.getProvider().download(userCode, resourceId, relativePath);
    }

    public void delete(String userCode, Long resourceId, List<String> relativePaths) {
        providerFactory.getProvider().delete(userCode, resourceId, relativePaths);
    }

    public void rename(String userCode, Long resourceId, String sourcePath, String newName) {
        providerFactory.getProvider().rename(userCode, resourceId, sourcePath, newName);
    }

    public void move(String userCode, Long resourceId, List<String> sourcePaths, String targetDirectory) {
        providerFactory.getProvider().move(userCode, resourceId, sourcePaths, targetDirectory);
    }

    public void createFolder(String userCode, Long resourceId, String relativePath) {
        providerFactory.getProvider().createFolder(userCode, resourceId, relativePath);
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
}
