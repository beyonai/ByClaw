package com.iwhalecloud.byai.state.application.service.filebrowser;

import java.util.Map;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

@Component
public class FileBrowserProviderFactory {

    private static final String BRAND_VERSION_CODE = "BYAI_BRAND_VERSION";
    private static final String COMMERCIAL = "commercial";

    private final Map<FileBrowserType, FileBrowserProvider> providers;
    private final ByaiSystemConfigService systemConfigService;

    public FileBrowserProviderFactory(
            MinioFileBrowserProvider minioProvider,
            OpenClawFileBrowserProvider openClawProvider,
            ByaiSystemConfigService systemConfigService) {
        this.providers = Map.of(
            FileBrowserType.MINIO, minioProvider,
            FileBrowserType.OPENCLAW, openClawProvider
        );
        this.systemConfigService = systemConfigService;
    }

    public FileBrowserProvider getProvider() {
        String brandVersion = systemConfigService.getDcSystemConfigValueByCode(BRAND_VERSION_CODE);
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
