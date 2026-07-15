package com.iwhalecloud.byai.manager.application.service.storage;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.storage.ObjectStorage;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageQuota;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageQuotaMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.anyLong;

import org.springframework.test.util.ReflectionTestUtils;

class UserStorageUsageScannerTest {

    @Test
    void scanFailureOnlyUpdatesErrorColumnsAndKeepsLastUsageSnapshot() {
        UserStorageQuotaMapper mapper = mock(UserStorageQuotaMapper.class);
        ObjectStorage objectStorage = mock(ObjectStorage.class);
        UserStorageQuotaApplicationService quotaService = mock(UserStorageQuotaApplicationService.class);
        when(objectStorage.list(any(), any())).thenThrow(new IllegalStateException("storage unavailable"));

        UserStorageUsageScanner scanner = new UserStorageUsageScanner();
        ReflectionTestUtils.setField(scanner, "quotaMapper", mapper);
        ReflectionTestUtils.setField(scanner, "objectStorage", objectStorage);
        ReflectionTestUtils.setField(scanner, "quotaService", quotaService);

        UserStorageQuota quota = new UserStorageQuota();
        quota.setStorageQuotaId(11L);
        quota.setUserId(7L);
        quota.setBucketName("byclaw-user001");

        assertThat(scanner.scanOne(quota)).isEqualTo(-1L);
        verify(mapper).updateScanError(org.mockito.ArgumentMatchers.eq(11L), any(),
            org.mockito.ArgumentMatchers.contains("storage unavailable"));
        verify(mapper, never()).updateById(any());
        verify(quotaService, never()).recordUsage(any(), anyLong(), any());
    }
}
