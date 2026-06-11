package com.iwhalecloud.byai.common.storage.impl;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.storage.config.MinioConfig;

class MinioBucketMountSupportTest {

    @Test
    void mountSingleBucketOnAllTargets_fileBackendSkipsRcloneMount() {
        MinioBucketMountSupport support = new MinioBucketMountSupport();
        MinioMountHostExecutor executor = mock(MinioMountHostExecutor.class);
        ReflectionTestUtils.setField(support, "minioConfig", minioConfig(true));
        ReflectionTestUtils.setField(support, "minioMountHostExecutor", executor);
        ReflectionTestUtils.setField(support, "volumeBackend", "file");

        support.mountSingleBucketOnAllTargets("minio", "byclaw");

        verify(executor, never()).executeMountCommand(any(), anyString(), anyString(), anyString());
    }

    @Test
    void mountSingleBucketOnAllTargets_minioMountBackendRunsRcloneMount() {
        MinioBucketMountSupport support = new MinioBucketMountSupport();
        MinioMountHostExecutor executor = mock(MinioMountHostExecutor.class);
        when(executor.ensureRemoteDirectoryExists(any(), anyString())).thenReturn(false);
        when(executor.isRemoteDirectoryMounted(any(), anyString())).thenReturn(false).thenReturn(true);
        when(executor.inspectRemoteDirectoryState(any(), anyString())).thenReturn("ok");
        when(executor.maskSensitiveCommand(anyString(), anyString(), anyString())).thenAnswer(inv -> inv.getArgument(0));
        ReflectionTestUtils.setField(support, "minioConfig", minioConfig(true));
        ReflectionTestUtils.setField(support, "minioMountHostExecutor", executor);
        ReflectionTestUtils.setField(support, "volumeBackend", "minio-mount");

        support.mountSingleBucketOnAllTargets("minio", "byclaw");

        verify(executor).executeMountCommand(any(), anyString(), anyString(), anyString());
    }

    private MinioConfig minioConfig(boolean mountEnabled) {
        MinioConfig config = new MinioConfig();
        config.setHost("127.0.0.1");
        config.getApi().setPort(9000);
        config.setAccessKey("access");
        config.setSecretKey("secret");
        config.getMount().setEnabled(mountEnabled);
        config.getMount().setPath("/data/minio");
        MinioConfig.Target target = new MinioConfig.Target();
        target.setEnabled(true);
        target.setHost("127.0.0.1");
        target.setPort(22);
        target.setUser("root");
        target.setPassword("password");
        config.getMount().setTargets(List.of(target));
        return config;
    }
}
