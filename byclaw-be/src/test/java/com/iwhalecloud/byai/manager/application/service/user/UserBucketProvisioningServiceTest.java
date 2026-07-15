package com.iwhalecloud.byai.manager.application.service.user;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.storage.ObjectStorage;
import com.iwhalecloud.byai.manager.application.service.storage.UserStorageQuotaApplicationService;

class UserBucketProvisioningServiceTest {

    private final UserStorageQuotaApplicationService storageQuotaService = mock(UserStorageQuotaApplicationService.class);

    @Test
    void ensureUserBucket_minioInitializesUserBucket() {
        ObjectStorage objectStorage = mock(ObjectStorage.class);
        FileStorageUserSpaceProvisioner fileProvisioner = mock(FileStorageUserSpaceProvisioner.class);
        UserBucketProvisioningService service = service("minio", objectStorage, fileProvisioner);

        service.ensureUserBucket("user001");

        verify(objectStorage).init("byclaw-user001");
        verify(fileProvisioner, never()).ensureUserSpace("byclaw-user001");
        verify(storageQuotaService).markProvisionReady("user001");
    }

    @Test
    void ensureUserBucket_fileInitializesUserPrivateDirectory() {
        ObjectStorage objectStorage = mock(ObjectStorage.class);
        FileStorageUserSpaceProvisioner fileProvisioner = mock(FileStorageUserSpaceProvisioner.class);
        UserBucketProvisioningService service = service("file", objectStorage, fileProvisioner);

        service.ensureUserBucket("user001");

        verify(fileProvisioner).ensureUserSpace("byclaw-user001");
        verify(objectStorage, never()).init("byclaw-user001");
    }

    @Test
    void ensureUserBucket_localInitializesUserPrivateDirectory() {
        ObjectStorage objectStorage = mock(ObjectStorage.class);
        FileStorageUserSpaceProvisioner fileProvisioner = mock(FileStorageUserSpaceProvisioner.class);
        UserBucketProvisioningService service = service("local", objectStorage, fileProvisioner);

        service.ensureUserBucket("user001");

        verify(fileProvisioner).ensureUserSpace("byclaw-user001");
        verify(objectStorage, never()).init("byclaw-user001");
    }

    @Test
    void ensureUserBucket_otherStorageSkipsProvisioning() {
        ObjectStorage objectStorage = mock(ObjectStorage.class);
        FileStorageUserSpaceProvisioner fileProvisioner = mock(FileStorageUserSpaceProvisioner.class);
        UserBucketProvisioningService service = service("aliyun-oss", objectStorage, fileProvisioner);

        service.ensureUserBucket("user001");

        verify(objectStorage, never()).init("byclaw-user001");
        verify(fileProvisioner, never()).ensureUserSpace("byclaw-user001");
    }

    private UserBucketProvisioningService service(String storageType, ObjectStorage objectStorage,
        FileStorageUserSpaceProvisioner fileProvisioner) {
        UserBucketNamingService namingService = mock(UserBucketNamingService.class);
        when(namingService.buildUserBucketName("user001")).thenReturn("byclaw-user001");
        UserBucketProvisioningService service = new UserBucketProvisioningService();
        ReflectionTestUtils.setField(service, "storageType", storageType);
        ReflectionTestUtils.setField(service, "objectStorage", objectStorage);
        ReflectionTestUtils.setField(service, "userBucketNamingService", namingService);
        ReflectionTestUtils.setField(service, "fileStorageUserSpaceProvisioner", fileProvisioner);
        ReflectionTestUtils.setField(service, "storageQuotaService", storageQuotaService);
        return service;
    }
}
