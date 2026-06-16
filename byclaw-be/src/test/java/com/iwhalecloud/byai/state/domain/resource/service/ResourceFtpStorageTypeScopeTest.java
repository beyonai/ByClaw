package com.iwhalecloud.byai.state.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.storage.FileIngressService;
import com.iwhalecloud.byai.common.storage.config.FtpConfig;
import com.iwhalecloud.byai.common.storage.config.ObjectStorageConfiguration;
import com.iwhalecloud.byai.common.storage.constants.StorageType;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;

@ExtendWith(MockitoExtension.class)
class ResourceFtpStorageTypeScopeTest {

    @Mock
    private FileIngressService fileIngressService;

    @Mock
    private ResourceArtifactPathResolver pathResolver;

    @AfterEach
    void tearDown() {
        ObjectStorageConfiguration.clearStorageType();
    }

    @Test
    void resourceJsonSyncClearsTemporaryFtpStorageType() {
        ObjectStorageConfiguration configuration = configuration();
        ResourceJsonFtpSyncService service = new ResourceJsonFtpSyncService();
        ReflectionTestUtils.setField(service, "fileIngressService", fileIngressService);
        ReflectionTestUtils.setField(service, "ftpConfig", ftpConfig());
        ReflectionTestUtils.setField(service, "pathResolver", pathResolver);
        when(pathResolver.resolveFtpAbsoluteBasePath()).thenReturn("/remote/resource");
        when(pathResolver.resolveResourceDirectory("TOOL")).thenReturn("tool");
        when(pathResolver.buildResourceJsonFileName("TOOL", 10L)).thenReturn("TOOL_10.json");

        service.syncByResourceBizType("{}", "TOOL", 10L);

        assertThat(configuration.getStorageType()).isEqualTo(StorageType.FILE);
    }

    @Test
    void resourcePackageUploadClearsTemporaryFtpStorageTypeWhenUploadFails() {
        ObjectStorageConfiguration configuration = configuration();
        ResourcePackageFtpUploadService service = new ResourcePackageFtpUploadService();
        ReflectionTestUtils.setField(service, "fileIngressService", fileIngressService);
        ReflectionTestUtils.setField(service, "ftpConfig", ftpConfig());
        ReflectionTestUtils.setField(service, "pathResolver", pathResolver);
        when(pathResolver.resolveFtpAbsoluteBasePath()).thenReturn("/remote/resource");
        doThrow(new IllegalStateException("upload failed"))
            .when(fileIngressService).uploadFile(any(), any(FileStorageContext.class));

        assertThatThrownBy(() -> service.uploadToSubdirectory(new byte[] {1}, "tool", "demo.json",
            "application/json"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("upload failed");

        assertThat(configuration.getStorageType()).isEqualTo(StorageType.FILE);
    }

    private ObjectStorageConfiguration configuration() {
        ObjectStorageConfiguration configuration = new ObjectStorageConfiguration();
        ReflectionTestUtils.setField(configuration, "storageType", StorageType.FILE);
        return configuration;
    }

    private FtpConfig ftpConfig() {
        FtpConfig ftpConfig = new FtpConfig();
        ftpConfig.setType(StorageType.SFTP);
        return ftpConfig;
    }
}
