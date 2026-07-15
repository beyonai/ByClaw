package com.iwhalecloud.byai.manager.application.service.storage;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageDowngradeCommand;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageDowngradeQuery;
import com.iwhalecloud.byai.manager.entity.notification.ByaiNotification;
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
import com.iwhalecloud.byai.manager.vo.storage.UserStorageDowngradeAdminVO;
import com.iwhalecloud.byai.manager.vo.storage.UserStorageDowngradePreviewVO;
import com.iwhalecloud.byai.state.domain.notification.service.NotificationService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/**
 * 存储增值包新增、取消与降级闭环。当前版本不包含支付或退款状态；支付接入后作为取消流程的子步骤扩展。
 */
@Service
public class UserStorageDowngradeApplicationService {

    public static final String SOURCE_USER = "USER";
    public static final String SOURCE_ADMIN = "ADMIN";
    public static final String TYPE_ADD_PACKAGE = "ADD_PACKAGE";
    public static final String TYPE_CANCEL_PACKAGE = "CANCEL_PACKAGE";

    public static final String STATUS_REQUESTED = "REQUESTED";
    public static final String STATUS_GRACE = "GRACE";
    public static final String STATUS_ARCHIVING = "ARCHIVING";
    public static final String STATUS_COMPLETED = "COMPLETED";
    public static final String STATUS_ARCHIVED = "ARCHIVED";
    public static final String STATUS_CANCELLED = "CANCELLED";
    public static final String STATUS_REJECTED = "REJECTED";

    private static final String GRANT_ACTIVE = UserStorageQuotaApplicationService.GRANT_ACTIVE;
    private static final String GRANT_REVOKED = UserStorageQuotaApplicationService.GRANT_REVOKED;
    private static final String OPERATION_ADD = "PACKAGE_ADD";
    private static final String OPERATION_CANCEL = "PACKAGE_CANCEL";
    private static final short STORAGE_NOTIFICATION_BIZ_TYPE = 1;
    private static final String STORAGE_RESOURCE_TYPE = "STORAGE_QUOTA";
    private static final long ONE_DAY_MILLIS = 86_400_000L;
    private static final Set<String> QUERY_STATUSES = Set.of(
        STATUS_REQUESTED, STATUS_GRACE, STATUS_ARCHIVING, STATUS_COMPLETED, STATUS_ARCHIVED,
        STATUS_CANCELLED, STATUS_REJECTED);
    private static final Set<String> QUERY_TYPES = Set.of(TYPE_ADD_PACKAGE, TYPE_CANCEL_PACKAGE);
    private static final int MAX_GRANTS_PER_CHANGE = 50;

    @Autowired
    private UserStorageQuotaApplicationService quotaService;

    @Autowired
    private UserStorageRecycleApplicationService recycleService;

    @Autowired
    private UserStorageGrantMapper grantMapper;

    @Autowired
    private StoragePackageMapper packageMapper;

    @Autowired
    private UserStorageDowngradeMapper downgradeMapper;

    @Autowired
    private UserStorageOperationMapper operationMapper;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private MessageSource messageSource;

    public UserStorageDowngradePreviewVO previewCancellation(Long grantId, Long expectedUserId) {
        return previewCancellation(normalizeGrantIds(null, grantId), expectedUserId);
    }

    public UserStorageDowngradePreviewVO previewCancellation(List<Long> grantIds, Long expectedUserId) {
        List<UserStorageGrant> grants = requireActiveGrants(normalizeGrantIds(grantIds, null), expectedUserId, false);
        return buildPreview(grants);
    }

    @Transactional(rollbackFor = Exception.class)
    public UserStorageDowngrade applyAddition(UserStorageDowngradeCommand command) {
        requireCommand(command);
        Long userId = currentUserId();
        String reason = normalizeText(command.getReason(), "申请说明", true);
        StoragePackageEntity storagePackage = requireEnabledPackage(command.getPackageId(), true);
        assertNoOpenChange(userId);

        UserStorageDowngrade change = createAddition(userId, storagePackage, SOURCE_USER, reason);
        downgradeMapper.insert(change);
        createOperation(change, "PENDING");
        sendNotification(change, "requested", null);
        return change;
    }

    @Transactional(rollbackFor = Exception.class)
    public UserStorageDowngrade applyCancellation(UserStorageDowngradeCommand command) {
        requireCommand(command);
        Long currentUserId = currentUserId();
        String reason = normalizeText(command.getReason(), "取消原因", true);
        List<Long> grantIds = normalizeGrantIds(command.getGrantIds(), command.getGrantId());
        List<UserStorageGrant> grants = requireActiveGrants(grantIds, currentUserId, true);
        assertNoOpenChange(currentUserId);

        UserStorageDowngradePreviewVO preview = buildPreview(grants);
        UserStorageDowngrade downgrade = createCancellation(grants, preview, SOURCE_USER, reason);
        downgradeMapper.insert(downgrade);
        createOperation(downgrade, "PENDING");
        sendNotification(downgrade, "requested", null);
        return downgrade;
    }

    @Transactional(rollbackFor = Exception.class)
    public UserStorageDowngrade withdrawChange(Long downgradeId) {
        UserStorageDowngrade downgrade = requireChangeForUpdate(downgradeId);
        if (!currentUserId().equals(downgrade.getUserId())) {
            throw new IllegalArgumentException("只能撤回本人的增值包变更申请");
        }
        if (!STATUS_REQUESTED.equals(downgrade.getDowngradeStatus())) {
            throw new IllegalStateException("只有待审核的增值包变更申请可以撤回");
        }
        Date now = new Date();
        downgrade.setDowngradeStatus(STATUS_CANCELLED);
        downgrade.setCompletedTime(now);
        downgrade.setVersion(nextVersion(downgrade));
        downgradeMapper.updateById(downgrade);
        finishOperation(downgrade.getRequestId(), STATUS_CANCELLED, null, null, null);
        sendNotification(downgrade, "withdrawn", null);
        return downgrade;
    }

    public UserStorageDowngrade withdrawCancellation(Long downgradeId) {
        return withdrawChange(downgradeId);
    }

    @Transactional(rollbackFor = Exception.class)
    public UserStorageDowngrade approveChange(UserStorageDowngradeCommand command) {
        requireCommand(command);
        UserStorageDowngrade downgrade = requireChangeForUpdate(command.getDowngradeId());
        if (!STATUS_REQUESTED.equals(downgrade.getDowngradeStatus())) {
            throw new IllegalStateException("只有待审核的增值包变更申请可以审核");
        }
        String reviewRemark = normalizeText(command.getReviewRemark(), "审核意见", false);
        return TYPE_ADD_PACKAGE.equals(downgrade.getRequestType())
            ? executeAddition(downgrade, reviewRemark) : executeCancellation(downgrade, reviewRemark);
    }

    public UserStorageDowngrade approveCancellation(UserStorageDowngradeCommand command) {
        return approveChange(command);
    }

    @Transactional(rollbackFor = Exception.class)
    public UserStorageDowngrade rejectChange(UserStorageDowngradeCommand command) {
        requireCommand(command);
        UserStorageDowngrade downgrade = requireChangeForUpdate(command.getDowngradeId());
        if (!STATUS_REQUESTED.equals(downgrade.getDowngradeStatus())) {
            throw new IllegalStateException("只有待审核的增值包变更申请可以驳回");
        }
        String reviewRemark = normalizeText(command.getReviewRemark(), "驳回原因", true);
        Date now = new Date();
        downgrade.setDowngradeStatus(STATUS_REJECTED);
        downgrade.setReviewRemark(reviewRemark);
        downgrade.setReviewedBy(currentUserId());
        downgrade.setReviewedTime(now);
        downgrade.setCompletedTime(now);
        downgrade.setVersion(nextVersion(downgrade));
        downgradeMapper.updateById(downgrade);
        finishOperation(downgrade.getRequestId(), STATUS_REJECTED, null, null, null);
        sendNotification(downgrade, "rejected", reviewRemark);
        return downgrade;
    }

    public UserStorageDowngrade rejectCancellation(UserStorageDowngradeCommand command) {
        return rejectChange(command);
    }

    @Transactional(rollbackFor = Exception.class)
    public UserStorageDowngrade adminAddPackage(Long userId, Long packageId, String reason) {
        StoragePackageEntity storagePackage = requireEnabledPackage(packageId, true);
        assertNoOpenChange(userId);
        UserStorageDowngrade change = createAddition(userId, storagePackage, SOURCE_ADMIN,
            normalizeText(reason, "授予说明", false));
        downgradeMapper.insert(change);
        createOperation(change, "PENDING");
        return executeAddition(change, reason);
    }

    @Transactional(rollbackFor = Exception.class)
    public UserStorageDowngrade adminCancelGrant(UserStorageDowngradeCommand command) {
        requireCommand(command);
        String reason = normalizeText(command.getReason(), "取消原因", true);
        List<Long> grantIds = normalizeGrantIds(command.getGrantIds(), command.getGrantId());
        List<UserStorageGrant> grants = requireActiveGrants(grantIds, null, true);
        assertNoOpenChange(grants.get(0).getUserId());
        UserStorageDowngradePreviewVO preview = buildPreview(grants);
        UserStorageDowngrade downgrade = createCancellation(grants, preview, SOURCE_ADMIN, reason);
        downgradeMapper.insert(downgrade);
        createOperation(downgrade, "PENDING");
        return executeCancellation(downgrade, reason);
    }

    public Page<UserStorageDowngradeAdminVO> listAdminPage(UserStorageDowngradeQuery request) {
        UserStorageDowngradeQuery query = normalizeQuery(request);
        return downgradeMapper.selectAdminPage(new Page<>(query.getPageNum(), query.getPageSize()), query);
    }

    public Page<UserStorageDowngradeAdminVO> listCurrentUserPage(UserStorageDowngradeQuery request) {
        UserStorageDowngradeQuery query = normalizeQuery(request);
        return downgradeMapper.selectUserPage(new Page<>(query.getPageNum(), query.getPageSize()), currentUserId(), query);
    }

    public List<UserStorageDowngradeAdminVO> listCurrentUserHistory() {
        UserStorageDowngradeQuery query = new UserStorageDowngradeQuery();
        query.setPageSize(100);
        return listCurrentUserPage(query).getRecords();
    }

    /**
     * 用户可在宽限期内主动归档，定时任务也会在宽限期截止后调用本方法。
     * 物理文件迁移不可参与数据库回滚，因此用条件更新抢占任务并依赖归档请求号保证幂等。
     */
    public UserStorageDowngrade archiveNow(Long downgradeId, Long expectedUserId) {
        UserStorageDowngrade current = downgradeMapper.selectById(downgradeId);
        if (current == null || !STATUS_GRACE.equals(current.getDowngradeStatus())) {
            throw new IllegalStateException("可归档的增值包取消记录不存在");
        }
        if (expectedUserId != null && !expectedUserId.equals(current.getUserId())) {
            throw new IllegalArgumentException("只能处理本人的增值包取消记录");
        }
        if (downgradeMapper.claimArchiving(downgradeId) != 1) {
            throw new IllegalStateException("该降级归档正在处理，请勿重复操作");
        }

        UserStorageDowngrade downgrade = downgradeMapper.selectById(downgradeId);
        try {
            String archiveRequestId = "ARCHIVE-" + downgrade.getRequestId();
            UserStorageRecycle recycle = recycleService.archiveForDowngrade(downgrade.getUserId(), archiveRequestId);
            Date now = new Date();
            downgrade.setDowngradeStatus(STATUS_ARCHIVED);
            downgrade.setRelatedRecycleId(recycle.getRecycleId());
            downgrade.setCompletedTime(now);
            downgrade.setErrorMessage(null);
            downgrade.setVersion(nextVersion(downgrade));
            downgradeMapper.updateById(downgrade);
            finishOperation(downgrade.getRequestId(), "SUCCESS", null, 0L, recycle.getRecycleId());
            trySendNotification(downgrade, "archived", null);
            return downgrade;
        }
        catch (RuntimeException e) {
            downgrade.setDowngradeStatus(STATUS_GRACE);
            downgrade.setErrorMessage(StringUtils.abbreviate(e.getMessage(), 2000));
            downgrade.setVersion(nextVersion(downgrade));
            downgradeMapper.updateById(downgrade);
            throw e;
        }
    }

    /** 检查已取消且处于宽限期的增值包，空间已降至目标值则结束，否则到期归档在线文件。 */
    public int processOpenDowngrades(int batchSize) {
        int limit = Math.max(1, Math.min(batchSize, 200));
        Date now = new Date();
        List<UserStorageDowngrade> records = downgradeMapper.selectList(
            new LambdaQueryWrapper<UserStorageDowngrade>()
                .eq(UserStorageDowngrade::getDowngradeStatus, STATUS_GRACE)
                .orderByAsc(UserStorageDowngrade::getGraceDeadline)
                .orderByAsc(UserStorageDowngrade::getDowngradeId)
                .last("LIMIT " + limit));
        int processed = 0;
        for (UserStorageDowngrade downgrade : records) {
            UserStorageQuota quota = quotaService.getRequired(downgrade.getUserId());
            long committedBytes = nonNegative(quota.getUsedBytes()) + nonNegative(quota.getReservedBytes());
            if (committedBytes <= nonNegative(downgrade.getTargetQuotaBytes())) {
                if (downgradeMapper.completeGrace(downgrade.getDowngradeId(), now) == 1) {
                    downgrade.setDowngradeStatus(STATUS_COMPLETED);
                    downgrade.setCompletedTime(now);
                    trySendNotification(downgrade, "completed", null);
                    processed++;
                }
            }
            else if (downgrade.getGraceDeadline() != null && !downgrade.getGraceDeadline().after(now)) {
                archiveNow(downgrade.getDowngradeId(), null);
                processed++;
            }
        }
        return processed;
    }

    private UserStorageDowngrade executeCancellation(UserStorageDowngrade downgrade, String reviewRemark) {
        List<UserStorageGrant> grants = requireActiveGrants(grantIdsOf(downgrade), downgrade.getUserId(), true);
        UserStorageDowngradePreviewVO preview = buildPreview(grants);
        Date now = new Date();

        for (UserStorageGrant grant : grants) {
            grant.setGrantStatus(GRANT_REVOKED);
            grant.setRevokedBy(currentUserId());
            grant.setRevokedTime(now);
            grantMapper.updateById(grant);
        }

        UserStorageQuota quota = quotaService.recalculateTotalQuota(downgrade.getUserId());
        long committedBytes = nonNegative(quota.getUsedBytes()) + nonNegative(quota.getReservedBytes());
        long targetQuotaBytes = nonNegative(quota.getTotalQuotaBytes());
        long overageBytes = Math.max(0L, committedBytes - targetQuotaBytes);

        downgrade.setBeforeQuotaBytes(preview.getBeforeQuotaBytes());
        downgrade.setTargetQuotaBytes(targetQuotaBytes);
        downgrade.setUsedBytesSnapshot(nonNegative(quota.getUsedBytes()));
        downgrade.setReservedBytesSnapshot(nonNegative(quota.getReservedBytes()));
        downgrade.setOverageBytes(overageBytes);
        downgrade.setReviewRemark(reviewRemark);
        downgrade.setReviewedBy(currentUserId());
        downgrade.setReviewedTime(now);
        downgrade.setErrorMessage(null);
        if (overageBytes > 0L) {
            downgrade.setDowngradeStatus(STATUS_GRACE);
            downgrade.setGraceDeadline(new Date(now.getTime()
                + Math.max(1, quotaService.getDowngradeGraceDays()) * ONE_DAY_MILLIS));
        }
        else {
            downgrade.setDowngradeStatus(STATUS_COMPLETED);
            downgrade.setCompletedTime(now);
        }
        downgrade.setVersion(nextVersion(downgrade));
        downgradeMapper.updateById(downgrade);
        finishOperation(downgrade.getRequestId(), "SUCCESS", targetQuotaBytes,
            nonNegative(quota.getUsedBytes()), null);
        sendNotification(downgrade, overageBytes > 0L ? "grace" : "approved", null);
        return downgrade;
    }

    private UserStorageDowngrade executeAddition(UserStorageDowngrade change, String reviewRemark) {
        StoragePackageEntity storagePackage = requireEnabledPackage(change.getPackageId(), true);
        UserStorageQuota quotaBefore = quotaService.getRequired(change.getUserId());
        long beforeQuotaBytes = nonNegative(quotaBefore.getTotalQuotaBytes());
        UserStorageGrant grant = quotaService.grantPackage(change.getUserId(), storagePackage.getPackageId(),
            change.getReason(), "APPLICATION", false);
        UserStorageQuota quotaAfter = quotaService.getRequired(change.getUserId());
        Date now = new Date();

        change.setGrantId(grant.getGrantId());
        change.setGrantIds(String.valueOf(grant.getGrantId()));
        change.setPackageNames(storagePackage.getPackageName());
        change.setChangeBytes(nonNegative(grant.getGrantedBytes()));
        change.setBeforeQuotaBytes(beforeQuotaBytes);
        change.setTargetQuotaBytes(nonNegative(quotaAfter.getTotalQuotaBytes()));
        change.setUsedBytesSnapshot(nonNegative(quotaAfter.getUsedBytes()));
        change.setReservedBytesSnapshot(nonNegative(quotaAfter.getReservedBytes()));
        change.setOverageBytes(0L);
        change.setReviewRemark(normalizeText(reviewRemark, "审核意见", false));
        change.setReviewedBy(currentUserId());
        change.setReviewedTime(now);
        change.setCompletedTime(now);
        change.setDowngradeStatus(STATUS_COMPLETED);
        change.setErrorMessage(null);
        change.setVersion(nextVersion(change));
        downgradeMapper.updateById(change);
        finishOperation(change.getRequestId(), "SUCCESS", change.getTargetQuotaBytes(),
            change.getUsedBytesSnapshot(), null);
        sendNotification(change, "approved", null);
        return change;
    }

    private UserStorageDowngrade createAddition(Long userId, StoragePackageEntity storagePackage,
        String source, String reason) {
        UserStorageQuota quota = quotaService.getRequired(userId);
        long beforeQuota = nonNegative(quota.getTotalQuotaBytes());
        long addonBytes = nonNegative(storagePackage.getAddonBytes());
        Date now = new Date();
        UserStorageDowngrade change = new UserStorageDowngrade();
        change.setDowngradeId(sequenceService.nextVal());
        change.setRequestId("PACKAGE-ADD-" + UUID.randomUUID());
        change.setUserId(userId);
        change.setPackageId(storagePackage.getPackageId());
        change.setPackageNames(storagePackage.getPackageName());
        change.setChangeBytes(addonBytes);
        change.setRequestSource(source);
        change.setRequestType(TYPE_ADD_PACKAGE);
        change.setDowngradeStatus(STATUS_REQUESTED);
        change.setGrantSource("APPLICATION");
        change.setBeforeQuotaBytes(beforeQuota);
        change.setTargetQuotaBytes(beforeQuota + addonBytes);
        change.setUsedBytesSnapshot(nonNegative(quota.getUsedBytes()));
        change.setReservedBytesSnapshot(nonNegative(quota.getReservedBytes()));
        change.setOverageBytes(0L);
        change.setReason(reason);
        change.setRequestedBy(currentUserId());
        change.setRequestedTime(now);
        change.setVersion(0L);
        return change;
    }

    private UserStorageDowngrade createCancellation(List<UserStorageGrant> grants,
        UserStorageDowngradePreviewVO preview, String source, String reason) {
        UserStorageGrant firstGrant = grants.get(0);
        Date now = new Date();
        UserStorageDowngrade downgrade = new UserStorageDowngrade();
        downgrade.setDowngradeId(sequenceService.nextVal());
        downgrade.setRequestId("PACKAGE-CANCEL-" + UUID.randomUUID());
        downgrade.setUserId(firstGrant.getUserId());
        downgrade.setGrantId(firstGrant.getGrantId());
        downgrade.setGrantIds(joinGrantIds(grants));
        downgrade.setPackageId(firstGrant.getPackageId());
        downgrade.setPackageNames(preview.getPackageNames());
        downgrade.setChangeBytes(preview.getGrantedBytes());
        downgrade.setRequestSource(source);
        downgrade.setRequestType(TYPE_CANCEL_PACKAGE);
        downgrade.setDowngradeStatus(STATUS_REQUESTED);
        downgrade.setGrantSource(grants.size() == 1 ? firstGrant.getGrantSource() : "MIXED");
        downgrade.setBeforeQuotaBytes(preview.getBeforeQuotaBytes());
        downgrade.setTargetQuotaBytes(preview.getTargetQuotaBytes());
        downgrade.setUsedBytesSnapshot(preview.getUsedBytes());
        downgrade.setReservedBytesSnapshot(preview.getReservedBytes());
        downgrade.setOverageBytes(preview.getOverageBytes());
        downgrade.setReason(reason);
        downgrade.setRequestedBy(currentUserId());
        downgrade.setRequestedTime(now);
        downgrade.setVersion(0L);
        return downgrade;
    }

    private UserStorageDowngradePreviewVO buildPreview(List<UserStorageGrant> grants) {
        UserStorageGrant firstGrant = grants.get(0);
        UserStorageQuota quota = quotaService.getRequired(firstGrant.getUserId());
        long activeAddonBytes = Math.max(0L, grantMapper.sumActiveBytes(firstGrant.getUserId()));
        long grantedBytes = grants.stream().mapToLong(grant -> nonNegative(grant.getGrantedBytes())).sum();
        long baseQuotaBytes = nonNegative(quota.getBaseQuotaBytes());
        long beforeQuotaBytes = baseQuotaBytes + activeAddonBytes;
        long targetQuotaBytes = Math.max(baseQuotaBytes, beforeQuotaBytes - grantedBytes);
        long usedBytes = nonNegative(quota.getUsedBytes());
        long reservedBytes = nonNegative(quota.getReservedBytes());
        long overageBytes = Math.max(0L, usedBytes + reservedBytes - targetQuotaBytes);

        UserStorageDowngradePreviewVO preview = new UserStorageDowngradePreviewVO();
        preview.setGrantId(firstGrant.getGrantId());
        preview.setGrantIds(grants.stream().map(grant -> String.valueOf(grant.getGrantId())).toList());
        preview.setUserId(firstGrant.getUserId());
        preview.setUserCode(quota.getUserCode());
        preview.setPackageId(firstGrant.getPackageId());
        preview.setGrantSource(grants.size() == 1 ? firstGrant.getGrantSource() : "MIXED");
        preview.setGrantedBytes(grantedBytes);
        preview.setSelectedGrantCount(grants.size());
        preview.setBeforeQuotaBytes(beforeQuotaBytes);
        preview.setTargetQuotaBytes(targetQuotaBytes);
        preview.setUsedBytes(usedBytes);
        preview.setReservedBytes(reservedBytes);
        preview.setOverageBytes(overageBytes);
        preview.setOverQuotaAfterDowngrade(overageBytes > 0L);
        preview.setHasOpenRequest(downgradeMapper.countOpenByUserId(firstGrant.getUserId()) > 0L);
        preview.setGraceDays(quotaService.getDowngradeGraceDays());
        preview.setPackageNames(summarizePackages(grants));
        preview.setPackageName(preview.getPackageNames());
        if (grants.size() == 1 && firstGrant.getPackageId() != null) {
            StoragePackageEntity storagePackage = packageMapper.selectById(firstGrant.getPackageId());
            if (storagePackage != null) {
                preview.setPackageCode(storagePackage.getPackageCode());
                preview.setPackageName(storagePackage.getPackageName());
                preview.setPackageNames(storagePackage.getPackageName());
            }
        }
        return preview;
    }

    private UserStorageGrant requireActiveGrant(Long grantId, Long expectedUserId, boolean lock) {
        if (grantId == null) {
            throw new IllegalArgumentException("增值包授权标识不能为空");
        }
        UserStorageGrant grant = lock ? grantMapper.selectByIdForUpdate(grantId) : grantMapper.selectById(grantId);
        if (grant == null || !GRANT_ACTIVE.equals(grant.getGrantStatus())) {
            throw new IllegalArgumentException("生效中的增值包授权不存在");
        }
        if (expectedUserId != null && !expectedUserId.equals(grant.getUserId())) {
            throw new IllegalArgumentException("无权取消该增值包");
        }
        return grant;
    }

    private List<UserStorageGrant> requireActiveGrants(List<Long> grantIds, Long expectedUserId, boolean lock) {
        List<UserStorageGrant> grants = new ArrayList<>(grantIds.size());
        Long ownerId = expectedUserId;
        for (Long grantId : grantIds) {
            UserStorageGrant grant = requireActiveGrant(grantId, ownerId, lock);
            if (ownerId == null) {
                ownerId = grant.getUserId();
            }
            else if (!ownerId.equals(grant.getUserId())) {
                throw new IllegalArgumentException("只能在一次申请中取消同一用户的增值包");
            }
            grants.add(grant);
        }
        return grants;
    }

    private StoragePackageEntity requireEnabledPackage(Long packageId, boolean lock) {
        if (packageId == null) {
            throw new IllegalArgumentException("增值包不能为空");
        }
        StoragePackageEntity storagePackage = lock
            ? packageMapper.selectByIdForUpdate(packageId) : packageMapper.selectById(packageId);
        if (storagePackage == null || !"ENABLED".equals(storagePackage.getStatus())) {
            throw new IllegalArgumentException("增值包不存在或已停用");
        }
        return storagePackage;
    }

    private UserStorageDowngrade requireChangeForUpdate(Long downgradeId) {
        if (downgradeId == null) {
            throw new IllegalArgumentException("增值记录标识不能为空");
        }
        UserStorageDowngrade downgrade = downgradeMapper.selectByIdForUpdate(downgradeId);
        if (downgrade == null) {
            throw new IllegalArgumentException("增值记录不存在");
        }
        return downgrade;
    }

    private void assertNoOpenChange(Long userId) {
        if (userId == null) {
            throw new IllegalArgumentException("用户标识不能为空");
        }
        if (downgradeMapper.countOpenByUserId(userId) > 0L) {
            throw new IllegalStateException("该用户已有进行中的增值包变更流程，请先处理完成");
        }
    }

    private List<Long> normalizeGrantIds(List<Long> grantIds, Long fallbackGrantId) {
        LinkedHashSet<Long> uniqueIds = new LinkedHashSet<>();
        if (grantIds != null) {
            for (Long grantId : grantIds) {
                if (grantId != null) {
                    uniqueIds.add(grantId);
                }
            }
        }
        if (uniqueIds.isEmpty() && fallbackGrantId != null) {
            uniqueIds.add(fallbackGrantId);
        }
        if (uniqueIds.isEmpty()) {
            throw new IllegalArgumentException("至少选择一个生效中的增值包");
        }
        if (uniqueIds.size() > MAX_GRANTS_PER_CHANGE) {
            throw new IllegalArgumentException("一次最多取消" + MAX_GRANTS_PER_CHANGE + "个增值包");
        }
        return new ArrayList<>(uniqueIds);
    }

    private List<Long> grantIdsOf(UserStorageDowngrade change) {
        List<Long> grantIds = new ArrayList<>();
        if (StringUtils.isNotBlank(change.getGrantIds())) {
            for (String value : StringUtils.split(change.getGrantIds(), ',')) {
                try {
                    grantIds.add(Long.valueOf(value.trim()));
                }
                catch (NumberFormatException e) {
                    throw new IllegalStateException("增值记录包含无效的权益标识", e);
                }
            }
        }
        return normalizeGrantIds(grantIds, change.getGrantId());
    }

    private static String joinGrantIds(List<UserStorageGrant> grants) {
        return String.join(",", grants.stream().map(grant -> String.valueOf(grant.getGrantId())).toList());
    }

    private String summarizePackages(List<UserStorageGrant> grants) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (UserStorageGrant grant : grants) {
            StoragePackageEntity storagePackage = grant.getPackageId() == null
                ? null : packageMapper.selectById(grant.getPackageId());
            String name = storagePackage == null ? "存储增值包" : storagePackage.getPackageName();
            counts.merge(name, 1, Integer::sum);
        }
        List<String> summaries = new ArrayList<>();
        counts.forEach((name, count) -> summaries.add(count > 1 ? name + " ×" + count : name));
        return String.join("、", summaries);
    }

    private UserStorageDowngradeQuery normalizeQuery(UserStorageDowngradeQuery request) {
        UserStorageDowngradeQuery query = request == null ? new UserStorageDowngradeQuery() : request;
        query.setPageNum(query.getPageNum() == null || query.getPageNum() < 1 ? 1 : query.getPageNum());
        query.setPageSize(query.getPageSize() == null || query.getPageSize() < 1
            ? 20 : Math.min(query.getPageSize(), 200));
        query.setUserCode(StringUtils.trimToNull(query.getUserCode()));
        String status = StringUtils.upperCase(StringUtils.trimToNull(query.getDowngradeStatus()), Locale.ROOT);
        if (status != null && !QUERY_STATUSES.contains(status)) {
            throw new IllegalArgumentException("不支持的增值记录状态: " + status);
        }
        query.setDowngradeStatus(status);
        String requestType = StringUtils.upperCase(StringUtils.trimToNull(query.getRequestType()), Locale.ROOT);
        if (requestType != null && !QUERY_TYPES.contains(requestType)) {
            throw new IllegalArgumentException("不支持的增值记录类型: " + requestType);
        }
        query.setRequestType(requestType);
        return query;
    }

    private void createOperation(UserStorageDowngrade downgrade, String status) {
        UserStorageOperation operation = new UserStorageOperation();
        operation.setOperationId(sequenceService.nextVal());
        operation.setRequestId(downgrade.getRequestId());
        operation.setUserId(downgrade.getUserId());
        operation.setOperationType(TYPE_ADD_PACKAGE.equals(downgrade.getRequestType())
            ? OPERATION_ADD : OPERATION_CANCEL);
        operation.setOperationStatus(status);
        operation.setOperatorId(currentUserId());
        operation.setBeforeQuota(downgrade.getBeforeQuotaBytes());
        operation.setAfterQuota(downgrade.getTargetQuotaBytes());
        operation.setBeforeUsed(downgrade.getUsedBytesSnapshot());
        operation.setAfterUsed(downgrade.getUsedBytesSnapshot());
        operation.setCreateTime(new Date());
        operationMapper.insert(operation);
    }

    private void finishOperation(String requestId, String status, Long afterQuota, Long afterUsed,
        Long recycleId) {
        UserStorageOperation operation = operationMapper.selectOne(new LambdaQueryWrapper<UserStorageOperation>()
            .eq(UserStorageOperation::getRequestId, requestId));
        if (operation == null) {
            return;
        }
        operation.setOperationStatus(status);
        if (afterQuota != null) {
            operation.setAfterQuota(afterQuota);
        }
        if (afterUsed != null) {
            operation.setAfterUsed(afterUsed);
        }
        operation.setRelatedRecycleId(recycleId);
        operation.setFinishTime(new Date());
        operationMapper.updateById(operation);
    }

    private void sendNotification(UserStorageDowngrade downgrade, String event, String detail) {
        if (notificationService == null || sequenceService == null) {
            return;
        }
        UserStorageQuota quota = quotaService.getRequired(downgrade.getUserId());
        StoragePackageEntity storagePackage = downgrade.getPackageId() == null
            ? null : packageMapper.selectById(downgrade.getPackageId());
        String packageName = StringUtils.defaultIfBlank(downgrade.getPackageNames(),
            storagePackage == null ? "存储增值包" : storagePackage.getPackageName());
        String targetQuota = formatStorageSize(downgrade.getTargetQuotaBytes());
        String changeSize = formatStorageSize(downgrade.getChangeBytes());
        String deadline = formatDate(downgrade.getGraceDeadline());
        boolean addition = TYPE_ADD_PACKAGE.equals(downgrade.getRequestType());
        String changeKind = addition ? "add" : "cancel";
        String messagePrefix = "storage.quota.notification." + changeKind + "." + event;
        Object[] args = notificationArgs(addition, event, packageName, changeSize, targetQuota, deadline, detail);
        Locale locale = LocaleContextHolder.getLocale();

        ByaiNotification notification = new ByaiNotification();
        notification.setId(sequenceService.nextVal());
        notification.setTitle(getMessage(messagePrefix + ".title", args, fallbackTitle(addition, event), locale));
        notification.setContent(getMessage(messagePrefix + ".content", args,
            fallbackContent(addition, event, packageName, changeSize, targetQuota, deadline, detail), locale));
        notification.setBizType(STORAGE_NOTIFICATION_BIZ_TYPE);
        notification.setPriority((short) 2);
        notification.setIsRead("0");
        notification.setResourceBizType(STORAGE_RESOURCE_TYPE);
        notification.setResourceId(quota.getStorageQuotaId());
        notification.setIsDeleted("0");
        notification.setSenderId(currentUserId());
        notification.setTargetId(downgrade.getUserId());
        notification.setCreateTime(new Date());

        Map<String, Object> values = new LinkedHashMap<>();
        values.put("packageName", packageName);
        values.put("changeBytes", changeSize);
        values.put("targetQuota", targetQuota);
        values.put("deadline", deadline);
        values.put("detail", StringUtils.defaultString(detail));
        Map<String, Object> extraInfo = new LinkedHashMap<>();
        extraInfo.put("eventType", "STORAGE_PACKAGE_" + changeKind.toUpperCase(Locale.ROOT)
            + "_" + event.toUpperCase(Locale.ROOT));
        extraInfo.put("titleMessageId", "storageQuota.notification." + changeKind + "." + event + ".title");
        extraInfo.put("contentMessageId", "storageQuota.notification." + changeKind + "." + event + ".content");
        extraInfo.put("messageValues", values);
        extraInfo.put("downgradeId", String.valueOf(downgrade.getDowngradeId()));
        extraInfo.put("grantId", String.valueOf(downgrade.getGrantId()));
        extraInfo.put("grantIds", StringUtils.defaultString(downgrade.getGrantIds()));
        notification.setExtraInfo(JSON.toJSONString(extraInfo));
        notificationService.save(notification, false);
    }

    private void trySendNotification(UserStorageDowngrade downgrade, String event, String detail) {
        try {
            sendNotification(downgrade, event, detail);
        }
        catch (RuntimeException ignored) {
            // 文件归档或宽限期完成已经落库，通知失败不反向破坏不可回滚的存储动作。
        }
    }

    private Object[] notificationArgs(boolean addition, String event, String packageName, String changeSize,
        String targetQuota, String deadline, String detail) {
        if (addition) {
            if ("rejected".equals(event)) {
                return new Object[] {packageName, StringUtils.defaultString(detail)};
            }
            return new Object[] {packageName, changeSize, targetQuota};
        }
        if ("grace".equals(event)) {
            return new Object[] {packageName, targetQuota, deadline};
        }
        if ("rejected".equals(event)) {
            return new Object[] {packageName, StringUtils.defaultString(detail)};
        }
        return new Object[] {packageName, targetQuota};
    }

    private String getMessage(String key, Object[] args, String fallback, Locale locale) {
        return messageSource == null ? fallback : messageSource.getMessage(key, args, fallback, locale);
    }

    private String fallbackTitle(boolean addition, String event) {
        if (addition) {
            return switch (event) {
                case "requested" -> "增值包新增申请已提交";
                case "withdrawn" -> "增值包新增申请已撤回";
                case "rejected" -> "增值包新增申请已驳回";
                default -> "增值包已新增";
            };
        }
        return switch (event) {
            case "requested" -> "增值包取消申请已提交";
            case "withdrawn" -> "增值包取消申请已撤回";
            case "rejected" -> "增值包取消申请已驳回";
            case "grace" -> "增值包已取消，请在宽限期内清理空间";
            case "archived" -> "超额在线文件已转入临时回收站";
            default -> "增值包已取消";
        };
    }

    private String fallbackContent(boolean addition, String event, String packageName, String changeSize,
        String targetQuota, String deadline, String detail) {
        if (addition) {
            return switch (event) {
                case "requested" -> packageName + "（" + changeSize + "）的新增申请已提交，等待管理员审核。";
                case "withdrawn" -> packageName + "的新增申请已撤回。";
                case "rejected" -> packageName + "的新增申请已驳回：" + StringUtils.defaultString(detail);
                default -> packageName + "已生效，当前总存储配额为" + targetQuota + "。";
            };
        }
        return switch (event) {
            case "requested" -> packageName + "的取消申请已提交，管理员确认前存储空间暂停新增写入。";
            case "withdrawn" -> packageName + "的取消申请已撤回。";
            case "rejected" -> packageName + "的取消申请已驳回：" + StringUtils.defaultString(detail);
            case "grace" -> packageName + "已取消，容量调整为" + targetQuota + "。请在" + deadline
                + "前将使用量降至上限内，否则在线文件将转入临时回收站。";
            case "archived" -> packageName + "取消后的超额在线文件已转入临时回收站。";
            case "completed" -> packageName + "取消后的空间降级已完成，当前容量为" + targetQuota + "。";
            default -> packageName + "已取消，当前容量为" + targetQuota + "。";
        };
    }

    private static String formatStorageSize(Long bytes) {
        long value = nonNegative(bytes);
        if (value >= 1024L * 1024L * 1024L) {
            return String.format(Locale.ROOT, "%.2f GB", value / (double) (1024L * 1024L * 1024L));
        }
        if (value >= 1024L * 1024L) {
            return String.format(Locale.ROOT, "%.2f MB", value / (double) (1024L * 1024L));
        }
        if (value >= 1024L) {
            return String.format(Locale.ROOT, "%.2f KB", value / 1024.0d);
        }
        return value + " B";
    }

    private static String formatDate(Date value) {
        return value == null ? "-" : new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.ROOT).format(value);
    }

    private static long nonNegative(Long value) {
        return value == null ? 0L : Math.max(0L, value);
    }

    private static long nextVersion(UserStorageDowngrade downgrade) {
        return downgrade.getVersion() == null ? 1L : downgrade.getVersion() + 1L;
    }

    private static void requireCommand(UserStorageDowngradeCommand command) {
        if (command == null) {
            throw new IllegalArgumentException("请求参数不能为空");
        }
    }

    private static String normalizeText(String value, String fieldName, boolean required) {
        String normalized = StringUtils.trimToNull(value);
        if (required && normalized == null) {
            throw new IllegalArgumentException(fieldName + "不能为空");
        }
        if (normalized != null && normalized.length() > 512) {
            throw new IllegalArgumentException(fieldName + "不能超过512个字符");
        }
        return normalized;
    }

    private static Long currentUserId() {
        return CurrentUserHolder.getCurrentUserId();
    }
}
