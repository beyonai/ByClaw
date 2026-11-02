package com.iwhalecloud.byai.state.application.service.filebrowser;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import java.util.Map;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

@Component
public class FileBrowserProviderFactory {

    private static final String FILE_BROWSER_TYPE = "FILE_BROWSER_TYPE";
    private static final String BRAND_VERSION_CODE = "BYAI_BRAND_VERSION";
    private static final String COMMERCIAL = "commercial";

    private final Map<FileBrowserType, FileBrowserProvider> providers;
    private final ByaiSystemConfigService systemConfigService;
    private final PlatformRemoteGateway platformGateway;
    private final String storageType;

    public FileBrowserProviderFactory(
            MinioFileBrowserProvider minioProvider,
            OpenClawFileBrowserProvider openClawProvider,
            ByaiSystemConfigService systemConfigService,
            PlatformRemoteGateway platformGateway,
            @org.springframework.beans.factory.annotation.Value("${file.storage.type:file}") String storageType) {
        this.providers = Map.of(
            FileBrowserType.MINIO, minioProvider,
            FileBrowserType.OPENCLAW, openClawProvider
        );
        this.systemConfigService = systemConfigService;
        this.platformGateway = platformGateway;
        this.storageType = storageType;
    }

    public FileBrowserProvider getProvider() {
        // Remote 下文件归平台管理；复用通用 ObjectStorage，不再依赖沙箱品牌或实例在线。
        if (platformGateway.isRemote()
                && com.iwhalecloud.byai.common.storage.constants.StorageType.isLocalFilesystem(storageType)) {
            return getProvider(FileBrowserType.MINIO);
        }
        String fileBrowserType = systemConfigService.getDcSystemConfigValueByCode(FILE_BROWSER_TYPE);
        if (FileBrowserType.MINIO.name().equalsIgnoreCase(fileBrowserType)) {
            return getProvider(FileBrowserType.MINIO);
        } else if (FileBrowserType.OPENCLAW.name().equalsIgnoreCase(fileBrowserType)) {
            return getProvider(FileBrowserType.OPENCLAW);
        }
        String brandVersion = systemConfigService.getDcSystemConfigValueByCode(BRAND_VERSION_CODE);
        FileBrowserType type = COMMERCIAL.equalsIgnoreCase(brandVersion)
            ? FileBrowserType.OPENCLAW
            : FileBrowserType.MINIO;
        return getProvider(type);
    }

    public FileBrowserProvider getProvider(FileBrowserType type) {
        FileBrowserProvider provider = providers.get(type);
        if (provider == null) {
            throw new IllegalArgumentException(I18nUtil.get("fileBrowser.provider.unsupported", type));
        }
        return provider;
    }
}
