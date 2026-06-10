package com.iwhalecloud.byai.state.application.service.filebrowser;

import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class FileBrowserProviderFactory {

    private static final String COMMERCIAL = "commercial";

    private final Map<FileBrowserType, FileBrowserProvider> providers;

    @Value("${BYAI_BRAND_VERSION:commercial}")
    private String brandVersion;

    public FileBrowserProviderFactory(
            MinioFileBrowserProvider minioProvider,
            OpenClawFileBrowserProvider openClawProvider) {
        this.providers = Map.of(
            FileBrowserType.MINIO, minioProvider,
            FileBrowserType.OPENCLAW, openClawProvider
        );
    }

    public FileBrowserProvider getProvider() {
        FileBrowserType type = COMMERCIAL.equalsIgnoreCase(brandVersion)
            ? FileBrowserType.OPENCLAW
            : FileBrowserType.MINIO;
        return getProvider(type);
    }

    public FileBrowserProvider getProvider(FileBrowserType type) {
        FileBrowserProvider provider = providers.get(type);
        if (provider == null) {
            throw new IllegalArgumentException("不支持的文件浏览器类型: " + type);
        }
        return provider;
    }
}
