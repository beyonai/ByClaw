package com.iwhalecloud.byai.manager.application.service.storage;

import java.util.Date;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageDowngradeCommand;
import com.iwhalecloud.byai.manager.entity.storage.StoragePackageEntity;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageDowngrade;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageGrant;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageOperation;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageQuota;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageRecycle;
import com.iwhalecloud.byai.manager.mapper.storage.StoragePackageMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageDowngradeMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageGrantMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageOperationMapper;
import com.iwhalecloud.byai.manager.vo.storage.UserStorageDowngradePreviewVO;
import com.iwhalecloud.byai.state.domain.notification.service.NotificationService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserStorageDowngradeApplicationServiceTest {

    private UserStorageQuotaApplicationService quotaService;
    private UserStorageRecycleApplicationService recycleService;
    private UserStorageGrantMapper grantMapper;
    private StoragePackageMapper packageMapper;
    private UserStorageDowngradeMapper downgradeMapper;
    private UserStorageOperationMapper operationMapper;
    private SequenceService sequenceService;
    private UserStorageDowngradeApplicationService service;

    @BeforeEach
    void setUp() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(7L);
        loginInfo.setUserCode("0027024710");
        CurrentUserHolder.setLoginInfo(loginInfo);

        quotaService = mock(UserStorageQuotaApplicationService.class);
        recycleService = mock(UserStorageRecycleApplicationService.class);
        grantMapper = mock(UserStorageGrantMapper.class);
        packageMapper = mock(StoragePackageMapper.class);
        downgradeMapper = mock(UserStorageDowngradeMapper.class);
        operationMapper = mock(UserStorageOperationMapper.class);
        sequenceService = mock(SequenceService.class);
        service = new UserStorageDowngradeApplicationService();
        ReflectionTestUtils.setField(service, "quotaService", quotaService);
        ReflectionTestUtils.setField(service, "recycleService", recycleService);
        ReflectionTestUtils.setField(service, "grantMapper", grantMapper);
        ReflectionTestUtils.setField(service, "packageMapper", packageMapper);
        ReflectionTestUtils.setField(service, "downgradeMapper", downgradeMapper);
        ReflectionTestUtils.setField(service, "operationMapper", operationMapper);
        ReflectionTestUtils.setField(service, "sequenceService", sequenceService);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void previewCalculatesTargetQuotaAndOverageWithoutPaymentSemantics() {
        when(grantMapper.selectById(11L)).thenReturn(activeGrant());
        when(grantMapper.sumActiveBytes(7L)).thenReturn(gb(2));
        when(quotaService.getRequired(7L)).thenReturn(quota(gb(2), gb(3) + gb(1) / 2, 0L));
        when(quotaService.getDowngradeGraceDays()).thenReturn(7);
        when(packageMapper.selectById(9L)).thenReturn(storagePackage());

        UserStorageDowngradePreviewVO preview = service.previewCancellation(11L, 7L);

        assertThat(preview.getBeforeQuotaBytes()).isEqualTo(gb(4));
        assertThat(preview.getTargetQuotaBytes()).isEqualTo(gb(3));
        assertThat(preview.getOverageBytes()).isEqualTo(gb(1) / 2);
        assertThat(preview.getOverQuotaAfterDowngrade()).isTrue();
        assertThat(preview.getGraceDays()).isEqualTo(7);
    }

    @Test
    void userCancellationCreatesPendingWorkflowAndFreezesThroughRequestedState() {
        NotificationService notificationService = mock(NotificationService.class);
        ReflectionTestUtils.setField(service, "notificationService", notificationService);
        when(sequenceService.nextVal()).thenReturn(101L, 102L, 103L);
        when(grantMapper.selectByIdForUpdate(11L)).thenReturn(activeGrant());
        when(grantMapper.sumActiveBytes(7L)).thenReturn(gb(1));
        when(quotaService.getRequired(7L)).thenReturn(quota(gb(2), gb(1), 0L));
        when(quotaService.getDowngradeGraceDays()).thenReturn(7);
        when(packageMapper.selectById(9L)).thenReturn(storagePackage());

        UserStorageDowngradeCommand command = new UserStorageDowngradeCommand();
        command.setGrantId(11L);
        command.setReason("当前不再需要扩容");
        UserStorageDowngrade result = service.applyCancellation(command);

        assertThat(result.getDowngradeStatus()).isEqualTo("REQUESTED");
        assertThat(result.getRequestType()).isEqualTo("CANCEL_PACKAGE");
        assertThat(result.getRequestSource()).isEqualTo("USER");
        assertThat(result.getReason()).isEqualTo("当前不再需要扩容");
        verify(downgradeMapper).insert(result);
        verify(operationMapper).insert(any(UserStorageOperation.class));
        verify(notificationService).save(any(), eq(false));
    }

    @Test
    void userAdditionCreatesPendingChangeWithoutGrantingBeforeAdminApproval() {
        when(sequenceService.nextVal()).thenReturn(101L, 102L);
        when(packageMapper.selectByIdForUpdate(9L)).thenReturn(storagePackage());
        when(quotaService.getRequired(7L)).thenReturn(quota(gb(2), gb(1), 0L));

        UserStorageDowngradeCommand command = new UserStorageDowngradeCommand();
        command.setPackageId(9L);
        command.setReason("项目需要扩容");
        UserStorageDowngrade result = service.applyAddition(command);

        assertThat(result.getRequestType()).isEqualTo("ADD_PACKAGE");
        assertThat(result.getDowngradeStatus()).isEqualTo("REQUESTED");
        assertThat(result.getGrantId()).isNull();
        assertThat(result.getChangeBytes()).isEqualTo(gb(1));
        assertThat(result.getTargetQuotaBytes()).isEqualTo(gb(4));
        verify(quotaService, never()).grantPackage(any(), any(), any(), any(), eq(false));
        verify(downgradeMapper).insert(result);
        verify(operationMapper).insert(any(UserStorageOperation.class));
    }

    @Test
    void approvingAdditionCreatesAnotherConcreteGrantSoSamePackageCanStack() {
        UserStorageDowngrade change = requestedAddition();
        UserStorageQuota beforeQuota = quota(gb(2), gb(1), 0L);
        UserStorageQuota afterQuota = quota(gb(2), gb(1), 0L);
        afterQuota.setAddonQuotaBytes(gb(2));
        afterQuota.setTotalQuotaBytes(gb(4));
        UserStorageGrant newGrant = activeGrant();
        newGrant.setGrantId(12L);
        newGrant.setGrantSource("APPLICATION");
        when(downgradeMapper.selectByIdForUpdate(101L)).thenReturn(change);
        when(packageMapper.selectByIdForUpdate(9L)).thenReturn(storagePackage());
        when(quotaService.getRequired(7L)).thenReturn(beforeQuota, afterQuota);
        when(quotaService.grantPackage(7L, 9L, "项目需要扩容", "APPLICATION", false)).thenReturn(newGrant);
        when(operationMapper.selectOne(any())).thenReturn(operation());

        UserStorageDowngradeCommand command = new UserStorageDowngradeCommand();
        command.setDowngradeId(101L);
        command.setReviewRemark("通过");
        UserStorageDowngrade result = service.approveChange(command);

        assertThat(result.getDowngradeStatus()).isEqualTo("COMPLETED");
        assertThat(result.getGrantId()).isEqualTo(12L);
        assertThat(result.getGrantIds()).isEqualTo("12");
        assertThat(result.getTargetQuotaBytes()).isEqualTo(gb(4));
        verify(quotaService).grantPackage(7L, 9L, "项目需要扩容", "APPLICATION", false);
        verify(downgradeMapper).updateById(change);
    }

    @Test
    void cancellationCanSelectMultipleSameOrDifferentPackageGrants() {
        UserStorageGrant first = activeGrant();
        UserStorageGrant second = secondActiveGrant();
        when(sequenceService.nextVal()).thenReturn(101L, 102L);
        when(grantMapper.selectByIdForUpdate(11L)).thenReturn(first);
        when(grantMapper.selectByIdForUpdate(12L)).thenReturn(second);
        when(grantMapper.sumActiveBytes(7L)).thenReturn(gb(1) + gb(1) / 2);
        when(quotaService.getRequired(7L)).thenReturn(quota(gb(2), gb(1), 0L));
        when(quotaService.getDowngradeGraceDays()).thenReturn(7);
        when(packageMapper.selectById(9L)).thenReturn(storagePackage());
        when(packageMapper.selectById(10L)).thenReturn(secondStoragePackage());

        UserStorageDowngradeCommand command = new UserStorageDowngradeCommand();
        command.setGrantIds(List.of(11L, 12L));
        command.setReason("合并取消闲置权益");
        UserStorageDowngrade result = service.applyCancellation(command);

        assertThat(result.getGrantIds()).isEqualTo("11,12");
        assertThat(result.getPackageNames()).contains("1G存储增值包", "512M存储增值包");
        assertThat(result.getChangeBytes()).isEqualTo(gb(1) + gb(1) / 2);
        assertThat(result.getTargetQuotaBytes()).isEqualTo(gb(2));
        verify(downgradeMapper).insert(result);
    }

    @Test
    void approvingMultiCancellationRevokesEverySelectedGrantAtomically() {
        UserStorageDowngrade change = requestedCancellation();
        change.setGrantIds("11,12");
        change.setPackageNames("1G存储增值包、512M存储增值包");
        UserStorageGrant first = activeGrant();
        UserStorageGrant second = secondActiveGrant();
        UserStorageQuota beforeQuota = quota(gb(2), gb(1), 0L);
        beforeQuota.setAddonQuotaBytes(gb(1) + gb(1) / 2);
        beforeQuota.setTotalQuotaBytes(gb(3) + gb(1) / 2);
        UserStorageQuota afterQuota = quota(gb(2), gb(1), 0L);
        afterQuota.setAddonQuotaBytes(0L);
        afterQuota.setTotalQuotaBytes(gb(2));
        when(downgradeMapper.selectByIdForUpdate(101L)).thenReturn(change);
        when(grantMapper.selectByIdForUpdate(11L)).thenReturn(first);
        when(grantMapper.selectByIdForUpdate(12L)).thenReturn(second);
        when(grantMapper.sumActiveBytes(7L)).thenReturn(gb(1) + gb(1) / 2);
        when(quotaService.getRequired(7L)).thenReturn(beforeQuota);
        when(quotaService.recalculateTotalQuota(7L)).thenReturn(afterQuota);
        when(quotaService.getDowngradeGraceDays()).thenReturn(7);
        when(packageMapper.selectById(9L)).thenReturn(storagePackage());
        when(packageMapper.selectById(10L)).thenReturn(secondStoragePackage());
        when(operationMapper.selectOne(any())).thenReturn(operation());

        UserStorageDowngradeCommand command = new UserStorageDowngradeCommand();
        command.setDowngradeId(101L);
        UserStorageDowngrade result = service.approveChange(command);

        assertThat(first.getGrantStatus()).isEqualTo("REVOKED");
        assertThat(second.getGrantStatus()).isEqualTo("REVOKED");
        assertThat(result.getTargetQuotaBytes()).isEqualTo(gb(2));
        assertThat(result.getDowngradeStatus()).isEqualTo("COMPLETED");
        verify(grantMapper).updateById(first);
        verify(grantMapper).updateById(second);
    }

    @Test
    void approvingCancellationRevokesGrantAndStartsGraceWhenUsageExceedsTarget() {
        UserStorageDowngrade downgrade = requestedCancellation();
        UserStorageGrant grant = activeGrant();
        UserStorageQuota beforeQuota = quota(gb(2), gb(3) + gb(1) / 2, 0L);
        UserStorageQuota afterQuota = quota(gb(2), gb(3) + gb(1) / 2, 0L);
        afterQuota.setTotalQuotaBytes(gb(2));
        when(downgradeMapper.selectByIdForUpdate(101L)).thenReturn(downgrade);
        when(grantMapper.selectByIdForUpdate(11L)).thenReturn(grant);
        when(grantMapper.sumActiveBytes(7L)).thenReturn(gb(1));
        when(quotaService.getRequired(7L)).thenReturn(beforeQuota);
        when(quotaService.recalculateTotalQuota(7L)).thenReturn(afterQuota);
        when(quotaService.getDowngradeGraceDays()).thenReturn(7);
        when(packageMapper.selectById(9L)).thenReturn(storagePackage());
        when(operationMapper.selectOne(any())).thenReturn(operation());

        UserStorageDowngradeCommand command = new UserStorageDowngradeCommand();
        command.setDowngradeId(101L);
        command.setReviewRemark("确认取消");
        UserStorageDowngrade result = service.approveCancellation(command);

        assertThat(grant.getGrantStatus()).isEqualTo("REVOKED");
        assertThat(result.getDowngradeStatus()).isEqualTo("GRACE");
        assertThat(result.getGraceDeadline()).isAfter(new Date());
        assertThat(result.getOverageBytes()).isEqualTo(gb(1) + gb(1) / 2);
        verify(grantMapper).updateById(grant);
        verify(downgradeMapper).updateById(downgrade);
    }

    @Test
    void rejectingCancellationKeepsActiveGrant() {
        UserStorageDowngrade downgrade = requestedCancellation();
        when(downgradeMapper.selectByIdForUpdate(101L)).thenReturn(downgrade);
        when(operationMapper.selectOne(any())).thenReturn(operation());

        UserStorageDowngradeCommand command = new UserStorageDowngradeCommand();
        command.setDowngradeId(101L);
        command.setReviewRemark("暂不允许取消");
        UserStorageDowngrade result = service.rejectCancellation(command);

        assertThat(result.getDowngradeStatus()).isEqualTo("REJECTED");
        assertThat(result.getReviewRemark()).isEqualTo("暂不允许取消");
        verify(grantMapper, never()).updateById(any());
        verify(downgradeMapper).updateById(downgrade);
    }

    @Test
    void cancellationIsRejectedWhenUserAlreadyHasOpenWorkflow() {
        when(grantMapper.selectByIdForUpdate(11L)).thenReturn(activeGrant());
        when(downgradeMapper.countOpenByUserId(7L)).thenReturn(1L);
        UserStorageDowngradeCommand command = new UserStorageDowngradeCommand();
        command.setGrantId(11L);
        command.setReason("取消");

        assertThatThrownBy(() -> service.applyCancellation(command))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("已有进行中");
        verify(downgradeMapper, never()).insert(any());
    }

    @Test
    void archiveNowMovesOnlineFilesToRecycleWithIdempotentArchiveRequest() {
        UserStorageDowngrade downgrade = requestedCancellation();
        downgrade.setDowngradeStatus("GRACE");
        when(downgradeMapper.selectById(101L)).thenReturn(downgrade);
        when(downgradeMapper.claimArchiving(101L)).thenReturn(1);
        UserStorageRecycle recycle = new UserStorageRecycle();
        recycle.setRecycleId(301L);
        when(recycleService.archiveForDowngrade(7L, "ARCHIVE-PACKAGE-CANCEL-TEST")).thenReturn(recycle);

        UserStorageDowngrade result = service.archiveNow(101L, 7L);

        assertThat(result.getDowngradeStatus()).isEqualTo("ARCHIVED");
        assertThat(result.getRelatedRecycleId()).isEqualTo(301L);
        verify(recycleService).archiveForDowngrade(7L, "ARCHIVE-PACKAGE-CANCEL-TEST");
        verify(downgradeMapper).updateById(downgrade);
    }

    private UserStorageGrant activeGrant() {
        UserStorageGrant grant = new UserStorageGrant();
        grant.setGrantId(11L);
        grant.setUserId(7L);
        grant.setPackageId(9L);
        grant.setGrantedBytes(gb(1));
        grant.setGrantStatus("ACTIVE");
        grant.setGrantSource("ADMIN");
        return grant;
    }

    private StoragePackageEntity storagePackage() {
        StoragePackageEntity storagePackage = new StoragePackageEntity();
        storagePackage.setPackageId(9L);
        storagePackage.setPackageCode("ADDON_1G");
        storagePackage.setPackageName("1G存储增值包");
        storagePackage.setAddonBytes(gb(1));
        storagePackage.setStatus("ENABLED");
        return storagePackage;
    }

    private UserStorageGrant secondActiveGrant() {
        UserStorageGrant grant = new UserStorageGrant();
        grant.setGrantId(12L);
        grant.setUserId(7L);
        grant.setPackageId(10L);
        grant.setGrantedBytes(gb(1) / 2);
        grant.setGrantStatus("ACTIVE");
        grant.setGrantSource("ADMIN");
        return grant;
    }

    private StoragePackageEntity secondStoragePackage() {
        StoragePackageEntity storagePackage = new StoragePackageEntity();
        storagePackage.setPackageId(10L);
        storagePackage.setPackageCode("ADDON_512M");
        storagePackage.setPackageName("512M存储增值包");
        storagePackage.setAddonBytes(gb(1) / 2);
        storagePackage.setStatus("ENABLED");
        return storagePackage;
    }

    private UserStorageQuota quota(long baseQuota, long usedBytes, long reservedBytes) {
        UserStorageQuota quota = new UserStorageQuota();
        quota.setStorageQuotaId(70L);
        quota.setUserId(7L);
        quota.setUserCode("0027024710");
        quota.setBaseQuotaBytes(baseQuota);
        quota.setAddonQuotaBytes(gb(1));
        quota.setTotalQuotaBytes(baseQuota + gb(1));
        quota.setUsedBytes(usedBytes);
        quota.setReservedBytes(reservedBytes);
        quota.setUsageStatus("NORMAL");
        return quota;
    }

    private UserStorageDowngrade requestedCancellation() {
        UserStorageDowngrade downgrade = new UserStorageDowngrade();
        downgrade.setDowngradeId(101L);
        downgrade.setRequestId("PACKAGE-CANCEL-TEST");
        downgrade.setUserId(7L);
        downgrade.setGrantId(11L);
        downgrade.setPackageId(9L);
        downgrade.setRequestSource("USER");
        downgrade.setRequestType("CANCEL_PACKAGE");
        downgrade.setDowngradeStatus("REQUESTED");
        downgrade.setGrantSource("ADMIN");
        downgrade.setBeforeQuotaBytes(gb(3));
        downgrade.setTargetQuotaBytes(gb(2));
        downgrade.setUsedBytesSnapshot(gb(1));
        downgrade.setReservedBytesSnapshot(0L);
        downgrade.setOverageBytes(0L);
        downgrade.setVersion(0L);
        return downgrade;
    }

    private UserStorageDowngrade requestedAddition() {
        UserStorageDowngrade change = new UserStorageDowngrade();
        change.setDowngradeId(101L);
        change.setRequestId("PACKAGE-ADD-TEST");
        change.setUserId(7L);
        change.setPackageId(9L);
        change.setPackageNames("1G存储增值包");
        change.setChangeBytes(gb(1));
        change.setRequestSource("USER");
        change.setRequestType("ADD_PACKAGE");
        change.setDowngradeStatus("REQUESTED");
        change.setGrantSource("APPLICATION");
        change.setBeforeQuotaBytes(gb(3));
        change.setTargetQuotaBytes(gb(4));
        change.setUsedBytesSnapshot(gb(1));
        change.setReservedBytesSnapshot(0L);
        change.setOverageBytes(0L);
        change.setReason("项目需要扩容");
        change.setVersion(0L);
        return change;
    }

    private UserStorageOperation operation() {
        UserStorageOperation operation = new UserStorageOperation();
        operation.setOperationId(201L);
        operation.setRequestId("PACKAGE-CANCEL-TEST");
        operation.setOperationStatus("PENDING");
        return operation;
    }

    private static long gb(long value) {
        return value * 1024L * 1024L * 1024L;
    }
}
