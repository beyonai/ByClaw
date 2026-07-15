package com.iwhalecloud.byai.manager.application.service.storage;

import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.context.MessageSource;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.common.storage.exception.StorageQuotaExceededException;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageGrantQuery;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageQuotaQuery;
import com.iwhalecloud.byai.manager.entity.notification.ByaiNotification;
import com.iwhalecloud.byai.manager.entity.storage.StoragePackageEntity;
import com.iwhalecloud.byai.manager.entity.storage.StorageQuotaSetting;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageDowngrade;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageQuota;
import com.iwhalecloud.byai.manager.mapper.storage.StoragePackageMapper;
import com.iwhalecloud.byai.manager.mapper.storage.StorageQuotaSettingMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageGrantMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageOperationMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageDowngradeMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageQuotaMapper;
import com.iwhalecloud.byai.manager.vo.storage.UserStorageQuotaAdminVO;
import com.iwhalecloud.byai.manager.vo.storage.UserStorageGrantAdminVO;
import com.iwhalecloud.byai.state.domain.notification.service.NotificationService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

class UserStorageQuotaApplicationServiceTest {

    @Test
    void pendingAdditionDoesNotBlockWritesOrExposeDowngradeState() {
        UserStorageQuotaMapper quotaMapper = mock(UserStorageQuotaMapper.class);
        UserStorageDowngradeMapper downgradeMapper = mock(UserStorageDowngradeMapper.class);
        UserStorageQuotaApplicationService service = quotaViewService(quotaMapper, downgradeMapper);
        UserStorageDowngrade addition = new UserStorageDowngrade();
        addition.setRequestType(UserStorageDowngradeApplicationService.TYPE_ADD_PACKAGE);
        addition.setDowngradeStatus("REQUESTED");
        when(downgradeMapper.selectOne(any())).thenReturn(addition);

        Map<String, Object> result = service.buildQuotaView(7L);

        assertThat(result.get("writeBlocked")).isEqualTo(false);
        assertThat(result.get("writeBlockReason")).isNull();
    }

    @Test
    void pendingCancellationStillBlocksWrites() {
        UserStorageQuotaMapper quotaMapper = mock(UserStorageQuotaMapper.class);
        UserStorageDowngradeMapper downgradeMapper = mock(UserStorageDowngradeMapper.class);
        UserStorageQuotaApplicationService service = quotaViewService(quotaMapper, downgradeMapper);
        UserStorageDowngrade cancellation = new UserStorageDowngrade();
        cancellation.setDowngradeId(99L);
        cancellation.setRequestType(UserStorageDowngradeApplicationService.TYPE_CANCEL_PACKAGE);
        cancellation.setDowngradeStatus("REQUESTED");
        cancellation.setTargetQuotaBytes(2L * 1024 * 1024 * 1024);
        when(downgradeMapper.selectOne(any())).thenReturn(cancellation);

        Map<String, Object> result = service.buildQuotaView(7L);

        assertThat(result.get("writeBlocked")).isEqualTo(true);
        assertThat(result.get("writeBlockReason")).isEqualTo("DOWNGRADE_FROZEN");
    }

    private UserStorageQuotaApplicationService quotaViewService(UserStorageQuotaMapper quotaMapper,
        UserStorageDowngradeMapper downgradeMapper) {
        UserStorageQuota quota = new UserStorageQuota();
        quota.setUserId(7L);
        quota.setBaseQuotaBytes(2L * 1024 * 1024 * 1024);
        quota.setAddonQuotaBytes(0L);
        quota.setTotalQuotaBytes(2L * 1024 * 1024 * 1024);
        quota.setUsedBytes(1024L);
        quota.setReservedBytes(0L);
        quota.setUsageStatus(UserStorageQuotaApplicationService.USAGE_NORMAL);
        when(quotaMapper.selectOne(any())).thenReturn(quota);
        UserStorageQuotaApplicationService service = new UserStorageQuotaApplicationService();
        ReflectionTestUtils.setField(service, "quotaMapper", quotaMapper);
        ReflectionTestUtils.setField(service, "downgradeMapper", downgradeMapper);
        return service;
    }

    @Test
    void reserveWriteRejectsWhenDatabaseConditionalUpdateDoesNotMatch() {
        UserStorageQuotaMapper mapper = mock(UserStorageQuotaMapper.class);
        when(mapper.reserveWrite(7L, 1024L)).thenReturn(0);
        UserStorageQuotaApplicationService service = new UserStorageQuotaApplicationService();
        ReflectionTestUtils.setField(service, "quotaMapper", mapper);

        assertThatThrownBy(() -> service.reserveWrite(7L, 1024L))
            .isInstanceOf(StorageQuotaExceededException.class)
            .hasMessageContaining("存储空间不足");
    }

    @Test
    void commitWriteMovesReservationToUsedBytesWithCurrentWarningThreshold() {
        UserStorageQuotaMapper mapper = mock(UserStorageQuotaMapper.class);
        StorageQuotaSettingMapper settingMapper = mock(StorageQuotaSettingMapper.class);
        StorageQuotaSetting setting = new StorageQuotaSetting();
        setting.setWarningPercent(90);
        when(settingMapper.selectById(1L)).thenReturn(setting);
        when(mapper.commitWrite(7L, 1024L, 90)).thenReturn(1);
        UserStorageQuotaApplicationService service = new UserStorageQuotaApplicationService();
        ReflectionTestUtils.setField(service, "quotaMapper", mapper);
        ReflectionTestUtils.setField(service, "settingMapper", settingMapper);

        service.commitWrite(7L, 1024L);

        verify(mapper).commitWrite(7L, 1024L, 90);
    }

    @Test
    void commitDeleteSubtractsUsedBytesWithCurrentWarningThreshold() {
        UserStorageQuotaMapper mapper = mock(UserStorageQuotaMapper.class);
        StorageQuotaSettingMapper settingMapper = mock(StorageQuotaSettingMapper.class);
        StorageQuotaSetting setting = new StorageQuotaSetting();
        setting.setWarningPercent(90);
        when(settingMapper.selectById(1L)).thenReturn(setting);
        when(mapper.commitDelete(7L, 1024L, 90)).thenReturn(1);
        UserStorageQuotaApplicationService service = new UserStorageQuotaApplicationService();
        ReflectionTestUtils.setField(service, "quotaMapper", mapper);
        ReflectionTestUtils.setField(service, "settingMapper", settingMapper);

        service.commitDelete(7L, 1024L);

        verify(mapper).commitDelete(7L, 1024L, 90);
    }

    @Test
    void listQuotaPageNormalizesFiltersAndUsesServerSideQuery() {
        UserStorageQuotaMapper quotaMapper = mock(UserStorageQuotaMapper.class);
        UserStorageGrantMapper grantMapper = mock(UserStorageGrantMapper.class);
        UserStorageQuotaApplicationService service = new UserStorageQuotaApplicationService();
        ReflectionTestUtils.setField(service, "quotaMapper", quotaMapper);
        ReflectionTestUtils.setField(service, "grantMapper", grantMapper);

        UserStorageQuotaQuery query = new UserStorageQuotaQuery();
        query.setPageNum(0);
        query.setPageSize(500);
        query.setUserCode("  0027  ");
        query.setUsageStatus("warning");
        query.setHasValidRecycle(true);
        query.setSortField("usedBytes");
        query.setSortOrder("ascend");
        Page<UserStorageQuotaAdminVO> resultPage = new Page<>(1, 200);
        UserStorageQuotaAdminVO record = new UserStorageQuotaAdminVO();
        record.setUserId(7L);
        resultPage.setRecords(List.of(record));
        when(quotaMapper.selectAdminPage(any(Page.class), eq(query))).thenReturn(resultPage);
        when(grantMapper.selectList(any())).thenReturn(List.of());

        Page<UserStorageQuotaAdminVO> result = service.listQuotaPage(query);

        assertThat(result).isSameAs(resultPage);
        assertThat(query.getPageNum()).isEqualTo(1);
        assertThat(query.getPageSize()).isEqualTo(200);
        assertThat(query.getUserCode()).isEqualTo("0027");
        assertThat(query.getUsageStatus()).isEqualTo("WARNING");
        assertThat(query.getHasValidRecycle()).isTrue();
        assertThat(query.getSortOrder()).isEqualTo("asc");
        verify(quotaMapper).selectAdminPage(any(Page.class), eq(query));
    }

    @Test
    void listQuotaPageDefaultsToUsedBytesDescending() {
        UserStorageQuotaMapper quotaMapper = mock(UserStorageQuotaMapper.class);
        UserStorageQuotaApplicationService service = new UserStorageQuotaApplicationService();
        ReflectionTestUtils.setField(service, "quotaMapper", quotaMapper);

        UserStorageQuotaQuery query = new UserStorageQuotaQuery();
        Page<UserStorageQuotaAdminVO> resultPage = new Page<>(1, 20);
        when(quotaMapper.selectAdminPage(any(Page.class), eq(query))).thenReturn(resultPage);

        service.listQuotaPage(query);

        assertThat(query.getSortField()).isEqualTo("usedBytes");
        assertThat(query.getSortOrder()).isEqualTo("desc");
    }

    @Test
    void listActiveGrantPageNormalizesFiltersAndUsesActiveGrantQuery() {
        UserStorageGrantMapper grantMapper = mock(UserStorageGrantMapper.class);
        UserStorageQuotaApplicationService service = new UserStorageQuotaApplicationService();
        ReflectionTestUtils.setField(service, "grantMapper", grantMapper);

        UserStorageGrantQuery query = new UserStorageGrantQuery();
        query.setPageNum(0);
        query.setPageSize(500);
        query.setUserCode("  0027  ");
        Page<UserStorageGrantAdminVO> resultPage = new Page<>(1, 200);
        when(grantMapper.selectActiveAdminPage(any(Page.class), eq(query))).thenReturn(resultPage);

        Page<UserStorageGrantAdminVO> result = service.listActiveGrantPage(query);

        assertThat(result).isSameAs(resultPage);
        assertThat(query.getPageNum()).isEqualTo(1);
        assertThat(query.getPageSize()).isEqualTo(200);
        assertThat(query.getUserCode()).isEqualTo("0027");
        verify(grantMapper).selectActiveAdminPage(any(Page.class), eq(query));
    }

    @Test
    void listPackagesReturnsActiveUserCount() {
        StoragePackageMapper packageMapper = mock(StoragePackageMapper.class);
        UserStorageQuotaApplicationService service = new UserStorageQuotaApplicationService();
        ReflectionTestUtils.setField(service, "packageMapper", packageMapper);

        StoragePackageEntity storagePackage = new StoragePackageEntity();
        storagePackage.setPackageId(9L);
        when(packageMapper.selectList(any())).thenReturn(List.of(storagePackage));
        when(packageMapper.countActiveUsers(9L)).thenReturn(3L);

        assertThat(service.listPackages()).singleElement()
            .extracting(StoragePackageEntity::getUsedUserCount)
            .isEqualTo(3L);
    }

    @Test
    void grantPackageCreatesLocalizedNotificationForTargetUser() {
        UserStorageQuotaMapper quotaMapper = mock(UserStorageQuotaMapper.class);
        StoragePackageMapper packageMapper = mock(StoragePackageMapper.class);
        StorageQuotaSettingMapper settingMapper = mock(StorageQuotaSettingMapper.class);
        UserStorageGrantMapper grantMapper = mock(UserStorageGrantMapper.class);
        UserStorageOperationMapper operationMapper = mock(UserStorageOperationMapper.class);
        SequenceService sequenceService = mock(SequenceService.class);
        NotificationService notificationService = mock(NotificationService.class);
        MessageSource messageSource = mock(MessageSource.class);
        UserStorageQuotaApplicationService service = new UserStorageQuotaApplicationService();
        ReflectionTestUtils.setField(service, "quotaMapper", quotaMapper);
        ReflectionTestUtils.setField(service, "packageMapper", packageMapper);
        ReflectionTestUtils.setField(service, "settingMapper", settingMapper);
        ReflectionTestUtils.setField(service, "grantMapper", grantMapper);
        ReflectionTestUtils.setField(service, "operationMapper", operationMapper);
        ReflectionTestUtils.setField(service, "sequenceService", sequenceService);
        ReflectionTestUtils.setField(service, "notificationService", notificationService);
        ReflectionTestUtils.setField(service, "messageSource", messageSource);

        UserStorageQuota quota = new UserStorageQuota();
        quota.setStorageQuotaId(70L);
        quota.setUserId(7L);
        quota.setBaseQuotaBytes(2L * 1024 * 1024 * 1024);
        quota.setAddonQuotaBytes(0L);
        quota.setTotalQuotaBytes(2L * 1024 * 1024 * 1024);
        quota.setUsedBytes(0L);
        quota.setUsageStatus(UserStorageQuotaApplicationService.USAGE_NORMAL);
        StoragePackageEntity storagePackage = new StoragePackageEntity();
        storagePackage.setPackageId(9L);
        storagePackage.setPackageName("标准扩容包");
        storagePackage.setAddonBytes(1024L * 1024 * 1024);
        storagePackage.setStatus("ENABLED");
        StorageQuotaSetting setting = new StorageQuotaSetting();
        setting.setWarningPercent(90);
        when(quotaMapper.selectOne(any())).thenReturn(quota);
        when(packageMapper.selectByIdForUpdate(9L)).thenReturn(storagePackage);
        when(settingMapper.selectById(1L)).thenReturn(setting);
        when(grantMapper.sumActiveBytes(7L)).thenReturn(1024L * 1024 * 1024);
        when(sequenceService.nextVal()).thenReturn(101L, 102L, 103L);
        when(messageSource.getMessage(eq("storage.quota.notification.granted.title"),
            isNull(), any(Locale.class))).thenReturn("网盘存储增值包已授予");
        when(messageSource.getMessage(eq("storage.quota.notification.granted.content"),
            any(Object[].class), any(Locale.class))).thenReturn("增值包通知正文");

        service.grantPackage(7L, 9L, "test");

        ArgumentCaptor<ByaiNotification> notificationCaptor = ArgumentCaptor.forClass(ByaiNotification.class);
        verify(notificationService).save(notificationCaptor.capture(), eq(false));
        ByaiNotification notification = notificationCaptor.getValue();
        assertThat(notification.getTargetId()).isEqualTo(7L);
        assertThat(notification.getResourceId()).isEqualTo(70L);
        assertThat(notification.getTitle()).isEqualTo("网盘存储增值包已授予");
        assertThat(notification.getExtraInfo()).contains("STORAGE_PACKAGE_GRANTED")
            .contains("storageQuota.notification.granted.content")
            .contains("标准扩容包");
        verify(sequenceService, times(3)).nextVal();
        verify(quotaMapper).updateById(quota);
        verify(operationMapper).insert(any());
        verify(grantMapper).insert(any());
    }

    @Test
    void updatePackageRejectsPackageWithActiveUserEntitlements() {
        StoragePackageMapper packageMapper = mock(StoragePackageMapper.class);
        UserStorageQuotaApplicationService service = new UserStorageQuotaApplicationService();
        ReflectionTestUtils.setField(service, "packageMapper", packageMapper);

        StoragePackageEntity existing = new StoragePackageEntity();
        existing.setPackageId(9L);
        existing.setPackageCode("STANDARD");
        StoragePackageEntity request = new StoragePackageEntity();
        request.setPackageCode("STANDARD");
        request.setPackageName("标准扩容包（新）");
        request.setAddonBytes(2L * 1024 * 1024 * 1024);
        when(packageMapper.selectByCodeForUpdate("STANDARD")).thenReturn(existing);
        when(packageMapper.countActiveUsers(9L)).thenReturn(1L);

        assertThatThrownBy(() -> service.upsertPackage(request))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("增值包存在生效中的用户权益，不能修改");
        verify(packageMapper, never()).updateById(any());
    }

    @Test
    void deletePackageRejectsPackageWithActiveUserEntitlements() {
        StoragePackageMapper packageMapper = mock(StoragePackageMapper.class);
        UserStorageQuotaApplicationService service = new UserStorageQuotaApplicationService();
        ReflectionTestUtils.setField(service, "packageMapper", packageMapper);

        StoragePackageEntity existing = new StoragePackageEntity();
        existing.setPackageId(9L);
        when(packageMapper.selectByIdForUpdate(9L)).thenReturn(existing);
        when(packageMapper.countActiveUsers(9L)).thenReturn(2L);

        assertThatThrownBy(() -> service.deletePackage(9L))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("增值包存在生效中的用户权益，不能删除");
        verify(packageMapper, never()).deleteById(9L);
    }

    @Test
    void deletePackageRemovesPackageWithoutActiveEntitlements() {
        StoragePackageMapper packageMapper = mock(StoragePackageMapper.class);
        UserStorageQuotaApplicationService service = new UserStorageQuotaApplicationService();
        ReflectionTestUtils.setField(service, "packageMapper", packageMapper);

        StoragePackageEntity existing = new StoragePackageEntity();
        existing.setPackageId(9L);
        when(packageMapper.selectByIdForUpdate(9L)).thenReturn(existing);
        when(packageMapper.countActiveUsers(9L)).thenReturn(0L);

        assertThat(service.deletePackage(9L)).isEqualTo(9L);
        verify(packageMapper).deleteById(9L);
    }
}
