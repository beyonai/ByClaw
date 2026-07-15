package com.iwhalecloud.byai.manager.application.service.storage;

import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.exception.StorageQuotaExceededException;
import com.iwhalecloud.byai.common.storage.util.UserBucketNameResolver;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageGrantQuery;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageQuotaQuery;
import com.iwhalecloud.byai.manager.entity.notification.ByaiNotification;
import com.iwhalecloud.byai.manager.entity.storage.StoragePackageEntity;
import com.iwhalecloud.byai.manager.entity.storage.StorageQuotaSetting;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageGrant;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageDowngrade;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageOperation;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageQuota;
import com.iwhalecloud.byai.manager.mapper.storage.StoragePackageMapper;
import com.iwhalecloud.byai.manager.mapper.storage.StorageQuotaSettingMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageGrantMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageDowngradeMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageOperationMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageQuotaMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.vo.storage.StoragePackageSummaryVO;
import com.iwhalecloud.byai.manager.vo.storage.UserStorageGrantAdminVO;
import com.iwhalecloud.byai.manager.vo.storage.UserStorageQuotaAdminVO;
import com.iwhalecloud.byai.state.domain.notification.service.NotificationService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/**
 * 用户存储配额的数据库事实源服务。
 * Redis 只用于任务锁，当前容量、预占容量和授权全部以本服务写入的 DB 状态为准。
 */
@Service
public class UserStorageQuotaApplicationService {

    public static final String USAGE_NORMAL = "NORMAL";
    public static final String USAGE_WARNING = "WARNING";
    public static final String USAGE_EXCEEDED = "EXCEEDED";
    public static final String USAGE_RESETTING = "RESETTING";
    public static final String USAGE_RESTORING = "RESTORING";

    public static final String PROVISION_INIT = "INIT";
    public static final String PROVISION_READY = "READY";
    public static final String PROVISION_FAILED = "FAILED";

    public static final String GRANT_ACTIVE = "ACTIVE";
    public static final String GRANT_REVOKED = "REVOKED";

    public static final String OP_SUCCESS = "SUCCESS";
    public static final String OP_PENDING = "PENDING";
    public static final String OP_FAILED = "FAILED";

    private static final short STORAGE_NOTIFICATION_BIZ_TYPE = 1;
    private static final String STORAGE_RESOURCE_TYPE = "STORAGE_QUOTA";
    private static final String REQUEST_TYPE_CANCEL_PACKAGE = "CANCEL_PACKAGE";
    private static final String DELETE_FLAG_NORMAL = "0";
    private static final Set<String> QUOTA_SORT_FIELDS = Set.of(
        "usedBytes", "usageStatus", "recycleCreatedTime", "recycleExpiredTime");
    private static final Set<String> QUOTA_USAGE_STATUSES = Set.of(
        USAGE_NORMAL, USAGE_WARNING, USAGE_EXCEEDED, USAGE_RESETTING, USAGE_RESTORING);

    @Value("${byclaw.storage.quota.default-bytes:2147483648}")
    private long defaultQuotaBytes;

    @Value("${byclaw.storage.quota.warning-percent:90}")
    private int warningPercent;

    @Value("${file.storage.type:minio}")
    private String storageType;

    @Autowired
    private UserStorageQuotaMapper quotaMapper;

    @Autowired
    private StoragePackageMapper packageMapper;

    @Autowired
    private StorageQuotaSettingMapper settingMapper;

    @Autowired
    private UserStorageGrantMapper grantMapper;

    @Autowired
    private UserStorageDowngradeMapper downgradeMapper;

    @Autowired
    private UserStorageOperationMapper operationMapper;

    @Autowired
    private UsersMapper usersMapper;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private MessageSource messageSource;

    @Transactional(rollbackFor = Exception.class)
    public UserStorageQuota ensureQuota(Long userId, String userCode) {
        if (userId == null || StringUtils.isBlank(userCode)) {
            throw new IllegalArgumentException("userId和userCode不能为空");
        }
        String bucketName = UserBucketNameResolver.buildUserBucketName(userCode);
        UserStorageQuota existing = findByUserId(userId);
        if (existing != null) {
            boolean changed = !StringUtils.equals(existing.getUserCode(), userCode)
                || !StringUtils.equals(existing.getBucketName(), bucketName)
                || !StringUtils.equals(existing.getStorageType(), storageType);
            if (changed) {
                existing.setUserCode(userCode);
                existing.setBucketName(bucketName);
                existing.setStorageType(storageType);
                existing.setUpdateBy(currentUserId());
                existing.setUpdateTime(new Date());
                quotaMapper.updateById(existing);
            }
            return existing;
        }

        Date now = new Date();
        UserStorageQuota quota = new UserStorageQuota();
        quota.setStorageQuotaId(sequenceService.nextVal());
        quota.setUserId(userId);
        quota.setUserCode(userCode);
        quota.setBucketName(bucketName);
        quota.setStorageType(storageType);
        quota.setBaseQuotaBytes(getSettings().getDefaultQuotaBytes());
        quota.setAddonQuotaBytes(0L);
        quota.setTotalQuotaBytes(quota.getBaseQuotaBytes());
        quota.setUsedBytes(0L);
        quota.setReservedBytes(0L);
        quota.setUsageStatus(USAGE_NORMAL);
        quota.setProvisionStatus(PROVISION_INIT);
        quota.setQuotaSyncStatus("PENDING");
        quota.setVersion(0L);
        quota.setDeleteFlag(DELETE_FLAG_NORMAL);
        quota.setCreateBy(currentUserId());
        quota.setCreateTime(now);
        quota.setUpdateBy(currentUserId());
        quota.setUpdateTime(now);
        quotaMapper.insert(quota);
        return quota;
    }

    @Transactional(rollbackFor = Exception.class)
    public UserStorageQuota ensureQuotaByUserCode(String userCode) {
        Users user = usersMapper.selectOne(new LambdaQueryWrapper<Users>().eq(Users::getUserCode, userCode));
        if (user == null) {
            throw new IllegalArgumentException("用户不存在: " + userCode);
        }
        return ensureQuota(user.getUserId(), user.getUserCode());
    }

    /** 幂等补齐历史用户的配额记录，首次补齐后的真实使用量由扫描任务校准。 */
    @Transactional(rollbackFor = Exception.class)
    public int backfillHistoricalQuotas(int pageSize) {
        int limit = Math.max(1, Math.min(pageSize, 500));
        int count = 0;
        for (long pageNumber = 1; ; pageNumber++) {
            IPage<Users> page = usersMapper.selectPage(new Page<>(pageNumber, limit),
                new LambdaQueryWrapper<Users>().orderByAsc(Users::getUserId));
            if (page.getRecords() == null || page.getRecords().isEmpty()) {
                break;
            }
            for (Users user : page.getRecords()) {
                if (user != null && user.getUserId() != null && StringUtils.isNotBlank(user.getUserCode())) {
                    ensureQuota(user.getUserId(), user.getUserCode());
                    count++;
                }
            }
            if (pageNumber >= page.getPages()) {
                break;
            }
        }
        return count;
    }

    public UserStorageQuota findByUserId(Long userId) {
        if (userId == null) {
            return null;
        }
        return quotaMapper.selectOne(new LambdaQueryWrapper<UserStorageQuota>()
            .eq(UserStorageQuota::getUserId, userId)
            .eq(UserStorageQuota::getDeleteFlag, DELETE_FLAG_NORMAL));
    }

    public UserStorageQuota getRequired(Long userId) {
        UserStorageQuota quota = findByUserId(userId);
        if (quota == null) {
            throw new IllegalStateException("用户存储配额尚未初始化");
        }
        return quota;
    }

    public Map<String, Object> buildQuotaView(Long userId) {
        UserStorageQuota quota = getRequired(userId);
        Map<String, Object> result = new HashMap<>();
        long total = Math.max(0L, quota.getTotalQuotaBytes());
        long used = Math.max(0L, quota.getUsedBytes());
        result.put("userId", quota.getUserId());
        result.put("baseQuotaBytes", quota.getBaseQuotaBytes());
        result.put("addonQuotaBytes", quota.getAddonQuotaBytes());
        result.put("totalQuotaBytes", total);
        result.put("usedBytes", used);
        long reserved = quota.getReservedBytes() == null ? 0L : Math.max(0L, quota.getReservedBytes());
        result.put("reservedBytes", reserved);
        result.put("remainingBytes", Math.max(0L, total - used - reserved));
        result.put("usagePercent", total == 0 ? 100 : Math.min(100, used * 100.0d / total));
        result.put("usageStatus", quota.getUsageStatus());
        result.put("provisionStatus", quota.getProvisionStatus());
        result.put("quotaSyncStatus", quota.getQuotaSyncStatus());
        result.put("lastScanTime", quota.getLastScanTime());
        result.put("lastWarningTime", quota.getLastWarningTime());
        result.put("lastError", quota.getLastError());
        UserStorageDowngrade openDowngrade = findOpenDowngrade(userId);
        boolean workflowBlocked = openDowngrade != null
            && REQUEST_TYPE_CANCEL_PACKAGE.equals(openDowngrade.getRequestType())
            && "REQUESTED".equals(openDowngrade.getDowngradeStatus());
        boolean quotaBlocked = USAGE_EXCEEDED.equals(quota.getUsageStatus())
            || USAGE_RESETTING.equals(quota.getUsageStatus()) || USAGE_RESTORING.equals(quota.getUsageStatus());
        result.put("writeBlocked", workflowBlocked || quotaBlocked || total - used - reserved <= 0);
        result.put("writeBlockReason", workflowBlocked ? "DOWNGRADE_FROZEN"
            : USAGE_EXCEEDED.equals(quota.getUsageStatus()) ? "OVER_QUOTA_READ_ONLY"
                : quotaBlocked ? quota.getUsageStatus() : total - used - reserved <= 0 ? "QUOTA_EXHAUSTED" : null);
        if (openDowngrade != null) {
            result.put("downgradeId", String.valueOf(openDowngrade.getDowngradeId()));
            result.put("downgradeStatus", openDowngrade.getDowngradeStatus());
            result.put("downgradeTargetQuotaBytes", openDowngrade.getTargetQuotaBytes());
            result.put("downgradeGraceDeadline", openDowngrade.getGraceDeadline());
        }
        return result;
    }

    private UserStorageDowngrade findOpenDowngrade(Long userId) {
        if (downgradeMapper == null || userId == null) {
            return null;
        }
        return downgradeMapper.selectOne(new LambdaQueryWrapper<UserStorageDowngrade>()
            .eq(UserStorageDowngrade::getUserId, userId)
            .eq(UserStorageDowngrade::getRequestType, REQUEST_TYPE_CANCEL_PACKAGE)
            .in(UserStorageDowngrade::getDowngradeStatus, "REQUESTED", "GRACE", "ARCHIVING")
            .orderByDesc(UserStorageDowngrade::getRequestedTime)
            .last("LIMIT 1"));
    }

    @Transactional(rollbackFor = Exception.class)
    public void markProvisionReady(String userCode) {
        updateProvision(userCode, PROVISION_READY, null);
    }

    @Transactional(rollbackFor = Exception.class)
    public void markProvisionFailed(String userCode, Exception exception) {
        updateProvision(userCode, PROVISION_FAILED, exception == null ? null : exception.getMessage());
    }

    private void updateProvision(String userCode, String status, String error) {
        Users user = usersMapper.selectOne(new LambdaQueryWrapper<Users>().eq(Users::getUserCode, userCode));
        if (user == null) {
            return;
        }
        UserStorageQuota quota = ensureQuota(user.getUserId(), userCode);
        quota.setProvisionStatus(status);
        quota.setLastError(error);
        quota.setUpdateBy(currentUserId());
        quota.setUpdateTime(new Date());
        quotaMapper.updateById(quota);
    }

    public void reserveWrite(Long userId, long bytes) {
        if (bytes <= 0 || userId == null) {
            return;
        }
        if (quotaMapper.reserveWrite(userId, bytes) != 1) {
            String fallback = "用户存储空间不足或当前处于不可写状态";
            String message = messageSource == null ? fallback : messageSource.getMessage(
                "storage.quota.write.exceeded", null, fallback, LocaleContextHolder.getLocale());
            throw new StorageQuotaExceededException(message);
        }
    }

    public void commitWrite(Long userId, long bytes) {
        if (bytes <= 0 || userId == null) {
            return;
        }
        if (quotaMapper.commitWrite(userId, bytes, getWarningPercent()) != 1) {
            throw new IllegalStateException("用户存储写入已完成，但配额记账失败");
        }
    }

    public void releaseWrite(Long userId, long bytes) {
        if (bytes > 0 && userId != null) {
            quotaMapper.releaseWrite(userId, bytes);
        }
    }

    public void commitDelete(Long userId, long bytes) {
        if (bytes <= 0 || userId == null) {
            return;
        }
        if (quotaMapper.commitDelete(userId, bytes, getWarningPercent()) != 1) {
            throw new IllegalStateException("用户存储删除已完成，但配额记账失败");
        }
    }

    @Transactional(rollbackFor = Exception.class)
    public boolean recordUsage(UserStorageQuota quota, long usedBytes, Date scanTime) {
        if (quota == null || quota.getStorageQuotaId() == null) {
            return false;
        }
        long normalizedUsed = Math.max(0L, usedBytes);
        String previousStatus = quota.getUsageStatus();
        String nextStatus = resolveUsageStatus(quota, normalizedUsed);
        Date warningTime = quota.getLastWarningTime();
        String warningStatus = quota.getLastWarningStatus();
        int currentWarningPercent = getSettings().getWarningPercent();
        boolean crossedWarning = normalizedUsed * 100L >= quota.getTotalQuotaBytes() * currentWarningPercent
            && !USAGE_WARNING.equals(previousStatus) && !USAGE_EXCEEDED.equals(previousStatus);
        if (crossedWarning) {
            warningTime = scanTime;
            warningStatus = USAGE_WARNING;
        }
        else if (normalizedUsed * 100L < quota.getTotalQuotaBytes() * currentWarningPercent) {
            warningStatus = null;
        }

        int updated = quotaMapper.updateUsageIfVersion(quota.getStorageQuotaId(), quota.getVersion(), normalizedUsed,
            nextStatus, scanTime, warningTime, warningStatus, null);
        if (updated != 1) {
            return false;
        }
        if (crossedWarning) {
            sendWarningNotification(quota, normalizedUsed, scanTime);
        }
        return true;
    }

    private String resolveUsageStatus(UserStorageQuota quota, long usedBytes) {
        if (USAGE_RESETTING.equals(quota.getUsageStatus()) || USAGE_RESTORING.equals(quota.getUsageStatus())) {
            return quota.getUsageStatus();
        }
        if (usedBytes >= quota.getTotalQuotaBytes()) {
            return USAGE_EXCEEDED;
        }
        if (usedBytes * 100L >= quota.getTotalQuotaBytes() * getSettings().getWarningPercent()) {
            return USAGE_WARNING;
        }
        return USAGE_NORMAL;
    }

    private void sendWarningNotification(UserStorageQuota quota, long usedBytes, Date scanTime) {
        try {
            ByaiNotification notification = new ByaiNotification();
            notification.setId(sequenceService.nextVal());
            notification.setTitle("个人存储空间即将用满");
            notification.setContent("您的个人存储空间已使用 " + usedBytes + " / " + quota.getTotalQuotaBytes()
            + " 字节，已达到" + getSettings().getWarningPercent() + "%。请联系管理员扩容或清理文件。");
            notification.setBizType(STORAGE_NOTIFICATION_BIZ_TYPE);
            notification.setPriority((short) 3);
            notification.setIsRead("0");
            notification.setResourceBizType(STORAGE_RESOURCE_TYPE);
            notification.setIsDeleted("0");
            notification.setTargetId(quota.getUserId());
            notification.setCreateTime(scanTime);
            notification.setExtraInfo(JSON.toJSONString(Map.of("usedBytes", usedBytes,
                "totalQuotaBytes", quota.getTotalQuotaBytes(), "warningPercent", getSettings().getWarningPercent())));
            notificationService.save(notification, false);
        }
        catch (Exception ignored) {
            // 使用量状态已经落库，通知失败由下一次跨阈值或人工补发处理，不回滚空间扫描结果。
        }
    }

    public List<StoragePackageEntity> listPackages() {
        List<StoragePackageEntity> packages = packageMapper.selectList(new LambdaQueryWrapper<StoragePackageEntity>()
            .orderByAsc(StoragePackageEntity::getSortNo).orderByAsc(StoragePackageEntity::getPackageId));
        for (StoragePackageEntity storagePackage : packages) {
            storagePackage.setUsedUserCount(packageMapper.countActiveUsers(storagePackage.getPackageId()));
        }
        return packages;
    }

    /** 普通用户申请扩容时只允许选择当前启用的增值包。 */
    public List<StoragePackageEntity> listEnabledPackages() {
        return packageMapper.selectList(new LambdaQueryWrapper<StoragePackageEntity>()
            .eq(StoragePackageEntity::getStatus, "ENABLED")
            .orderByAsc(StoragePackageEntity::getSortNo)
            .orderByAsc(StoragePackageEntity::getPackageId));
    }

    public Page<UserStorageQuotaAdminVO> listQuotaPage(UserStorageQuotaQuery request) {
        UserStorageQuotaQuery query = normalizeQuotaQuery(request);
        Page<UserStorageQuotaAdminVO> page = new Page<>(query.getPageNum(), query.getPageSize());
        Page<UserStorageQuotaAdminVO> result = quotaMapper.selectAdminPage(page, query);
        enrichActivePackages(result.getRecords());
        return result;
    }

    /** 兼容旧版服务调用。 */
    public Page<UserStorageQuotaAdminVO> listQuotaPage(Integer pageNum, Integer pageSize, String keyword) {
        UserStorageQuotaQuery query = new UserStorageQuotaQuery();
        query.setPageNum(pageNum);
        query.setPageSize(pageSize);
        query.setKeyword(keyword);
        return listQuotaPage(query);
    }

    public Page<UserStorageGrantAdminVO> listActiveGrantPage(UserStorageGrantQuery request) {
        UserStorageGrantQuery query = normalizeGrantQuery(request);
        Page<UserStorageGrantAdminVO> page = new Page<>(query.getPageNum(), query.getPageSize());
        return grantMapper.selectActiveAdminPage(page, query);
    }

    public List<UserStorageGrant> listUserGrants(Long userId) {
        return grantMapper.selectList(new LambdaQueryWrapper<UserStorageGrant>()
            .eq(UserStorageGrant::getUserId, userId)
            .orderByDesc(UserStorageGrant::getGrantedTime));
    }

    public List<UserStorageGrantAdminVO> listUserActiveGrants(Long userId) {
        if (userId == null) {
            throw new IllegalArgumentException("用户标识不能为空");
        }
        return grantMapper.selectUserActiveGrants(userId);
    }

    @Transactional(rollbackFor = Exception.class)
    public StoragePackageEntity upsertPackage(StoragePackageEntity request) {
        if (request == null || StringUtils.isBlank(request.getPackageCode())
            || StringUtils.isBlank(request.getPackageName()) || request.getAddonBytes() == null
            || request.getAddonBytes() <= 0) {
            throw new IllegalArgumentException("增值包编码、名称和容量不能为空");
        }
        Date now = new Date();
        StoragePackageEntity existing = packageMapper.selectByCodeForUpdate(request.getPackageCode());
        if (existing == null) {
            request.setPackageId(sequenceService.nextVal());
            request.setStatus(StringUtils.defaultIfBlank(request.getStatus(), "ENABLED"));
            request.setSortNo(request.getSortNo() == null ? 0 : request.getSortNo());
            request.setCreateBy(currentUserId());
            request.setCreateTime(now);
            request.setUpdateBy(currentUserId());
            request.setUpdateTime(now);
            packageMapper.insert(request);
            request.setUsedUserCount(0L);
            return request;
        }
        assertPackageUnused(existing.getPackageId(), "修改");
        existing.setPackageName(request.getPackageName());
        existing.setAddonBytes(request.getAddonBytes());
        existing.setPrice(request.getPrice());
        existing.setStatus(StringUtils.defaultIfBlank(request.getStatus(), existing.getStatus()));
        existing.setSortNo(request.getSortNo() == null ? existing.getSortNo() : request.getSortNo());
        existing.setRemark(request.getRemark());
        existing.setUpdateBy(currentUserId());
        existing.setUpdateTime(now);
        packageMapper.updateById(existing);
        return existing;
    }

    @Transactional(rollbackFor = Exception.class)
    public Long deletePackage(Long packageId) {
        StoragePackageEntity existing = packageMapper.selectByIdForUpdate(packageId);
        if (existing == null) {
            throw new IllegalArgumentException("增值包不存在");
        }
        assertPackageUnused(packageId, "删除");
        packageMapper.deleteById(packageId);
        return packageId;
    }

    @Transactional(rollbackFor = Exception.class)
    public UserStorageGrant grantPackage(Long userId, Long packageId, String remark) {
        return grantPackage(userId, packageId, remark, "ADMIN", true);
    }

    @Transactional(rollbackFor = Exception.class)
    public UserStorageGrant grantPackage(Long userId, Long packageId, String remark, String source,
        boolean notifyUser) {
        UserStorageQuota quota = getRequired(userId);
        StoragePackageEntity pkg = packageMapper.selectByIdForUpdate(packageId);
        if (pkg == null || !"ENABLED".equals(pkg.getStatus())) {
            throw new IllegalArgumentException("增值包不存在或已停用");
        }
        Date now = new Date();
        UserStorageGrant grant = new UserStorageGrant();
        grant.setGrantId(sequenceService.nextVal());
        grant.setUserId(userId);
        grant.setPackageId(packageId);
        grant.setGrantedBytes(pkg.getAddonBytes());
        grant.setGrantStatus(GRANT_ACTIVE);
        grant.setGrantSource(StringUtils.defaultIfBlank(source, "ADMIN"));
        grant.setGrantedBy(currentUserId());
        grant.setGrantedTime(now);
        grant.setRemark(remark);
        grantMapper.insert(grant);
        long beforeTotal = quota.getTotalQuotaBytes();
        refreshTotalQuota(quota, now);
        saveOperation("GRANT-" + grant.getGrantId(), userId, "GRANT", OP_SUCCESS,
            beforeTotal, quota.getTotalQuotaBytes(),
            quota.getUsedBytes(), quota.getUsedBytes(), null, null);
        if (notifyUser) {
            sendGrantNotification(quota, pkg, grant, now);
        }
        return grant;
    }

    private void assertPackageUnused(Long packageId, String operation) {
        if (packageMapper.countActiveUsers(packageId) > 0) {
            throw new IllegalArgumentException("增值包存在生效中的用户权益，不能" + operation);
        }
    }

    @Transactional(rollbackFor = Exception.class)
    public UserStorageGrant revokeGrant(Long grantId, String remark) {
        UserStorageGrant grant = grantMapper.selectById(grantId);
        if (grant == null || !GRANT_ACTIVE.equals(grant.getGrantStatus())) {
            throw new IllegalArgumentException("生效中的增值授权不存在");
        }
        Date now = new Date();
        grant.setGrantStatus(GRANT_REVOKED);
        grant.setRevokedBy(currentUserId());
        grant.setRevokedTime(now);
        if (StringUtils.isNotBlank(remark)) {
            grant.setRemark(remark);
        }
        grantMapper.updateById(grant);
        UserStorageQuota quota = getRequired(grant.getUserId());
        long beforeTotal = quota.getTotalQuotaBytes();
        refreshTotalQuota(quota, now);
        saveOperation("REVOKE-" + grant.getGrantId(), grant.getUserId(), "REVOKE", OP_SUCCESS,
            beforeTotal, quota.getTotalQuotaBytes(),
            quota.getUsedBytes(), quota.getUsedBytes(), null, null);
        return grant;
    }

    private void refreshTotalQuota(UserStorageQuota quota, Date now) {
        long addon = grantMapper.sumActiveBytes(quota.getUserId());
        long total = quota.getBaseQuotaBytes() + addon;
        quota.setAddonQuotaBytes(addon);
        quota.setTotalQuotaBytes(total);
        if (!USAGE_RESETTING.equals(quota.getUsageStatus()) && !USAGE_RESTORING.equals(quota.getUsageStatus())) {
            quota.setUsageStatus(resolveUsageStatus(quota, quota.getUsedBytes()));
        }
        quota.setQuotaSyncStatus("PENDING");
        quota.setUpdateBy(currentUserId());
        quota.setUpdateTime(now);
        quotaMapper.updateById(quota);
    }

    @Transactional(rollbackFor = Exception.class)
    public UserStorageQuota recalculateTotalQuota(Long userId) {
        UserStorageQuota quota = getRequired(userId);
        refreshTotalQuota(quota, new Date());
        return quota;
    }

    private UserStorageQuotaQuery normalizeQuotaQuery(UserStorageQuotaQuery request) {
        UserStorageQuotaQuery query = request == null ? new UserStorageQuotaQuery() : request;
        query.setPageNum(query.getPageNum() == null || query.getPageNum() < 1 ? 1 : query.getPageNum());
        query.setPageSize(query.getPageSize() == null || query.getPageSize() < 1
            ? 20 : Math.min(query.getPageSize(), 200));
        query.setUserCode(StringUtils.trimToNull(query.getUserCode()));
        query.setKeyword(StringUtils.trimToNull(query.getKeyword()));

        String usageStatus = StringUtils.upperCase(StringUtils.trimToNull(query.getUsageStatus()), Locale.ROOT);
        if (usageStatus != null && !QUOTA_USAGE_STATUSES.contains(usageStatus)) {
            throw new IllegalArgumentException("不支持的存储配额状态: " + usageStatus);
        }
        query.setUsageStatus(usageStatus);

        String sortField = StringUtils.trimToNull(query.getSortField());
        if (sortField != null && !QUOTA_SORT_FIELDS.contains(sortField)) {
            throw new IllegalArgumentException("不支持的存储配额排序字段: " + sortField);
        }
        if (sortField == null) {
            query.setSortField("usedBytes");
            query.setSortOrder("desc");
            return query;
        }
        query.setSortField(sortField);

        String sortOrder = StringUtils.lowerCase(StringUtils.trimToEmpty(query.getSortOrder()), Locale.ROOT);
        if ("ascend".equals(sortOrder)) {
            sortOrder = "asc";
        }
        else if ("descend".equals(sortOrder)) {
            sortOrder = "desc";
        }
        if (!"asc".equals(sortOrder) && !"desc".equals(sortOrder)) {
            throw new IllegalArgumentException("不支持的存储配额排序方向: " + sortOrder);
        }
        query.setSortOrder(sortOrder);
        return query;
    }

    private UserStorageGrantQuery normalizeGrantQuery(UserStorageGrantQuery request) {
        UserStorageGrantQuery query = request == null ? new UserStorageGrantQuery() : request;
        query.setPageNum(query.getPageNum() == null || query.getPageNum() < 1 ? 1 : query.getPageNum());
        query.setPageSize(query.getPageSize() == null || query.getPageSize() < 1
            ? 20 : Math.min(query.getPageSize(), 200));
        query.setUserCode(StringUtils.trimToNull(query.getUserCode()));
        return query;
    }

    private void enrichActivePackages(List<UserStorageQuotaAdminVO> records) {
        if (records == null || records.isEmpty()) {
            return;
        }
        Set<Long> userIds = new LinkedHashSet<>();
        for (UserStorageQuotaAdminVO record : records) {
            userIds.add(record.getUserId());
        }
        List<UserStorageGrant> activeGrants = grantMapper.selectList(new LambdaQueryWrapper<UserStorageGrant>()
            .in(UserStorageGrant::getUserId, userIds)
            .eq(UserStorageGrant::getGrantStatus, GRANT_ACTIVE)
            .orderByAsc(UserStorageGrant::getGrantedTime)
            .orderByAsc(UserStorageGrant::getGrantId));
        if (activeGrants == null || activeGrants.isEmpty()) {
            return;
        }

        Set<Long> packageIds = new LinkedHashSet<>();
        Map<Long, Map<Long, List<UserStorageGrant>>> grantsByUser = new HashMap<>();
        for (UserStorageGrant grant : activeGrants) {
            if (grant.getPackageId() == null) {
                continue;
            }
            packageIds.add(grant.getPackageId());
            grantsByUser.computeIfAbsent(grant.getUserId(), ignored -> new LinkedHashMap<>())
                .computeIfAbsent(grant.getPackageId(), ignored -> new java.util.ArrayList<>())
                .add(grant);
        }
        if (packageIds.isEmpty()) {
            return;
        }
        List<StoragePackageEntity> activePackages = packageMapper.selectList(
            new LambdaQueryWrapper<StoragePackageEntity>()
                .in(StoragePackageEntity::getPackageId, packageIds)
                .orderByAsc(StoragePackageEntity::getSortNo)
                .orderByAsc(StoragePackageEntity::getPackageId));
        for (UserStorageQuotaAdminVO record : records) {
            Map<Long, List<UserStorageGrant>> userGrants = grantsByUser.get(record.getUserId());
            if (userGrants == null) {
                continue;
            }
            for (StoragePackageEntity storagePackage : activePackages) {
                List<UserStorageGrant> packageGrants = userGrants.get(storagePackage.getPackageId());
                if (packageGrants == null || packageGrants.isEmpty()) {
                    continue;
                }
                StoragePackageSummaryVO summary = new StoragePackageSummaryVO();
                summary.setPackageId(storagePackage.getPackageId());
                summary.setPackageCode(storagePackage.getPackageCode());
                summary.setPackageName(storagePackage.getPackageName());
                summary.setAddonBytes(storagePackage.getAddonBytes());
                summary.setQuantity(packageGrants.size());
                summary.setTotalGrantedBytes(packageGrants.stream()
                    .mapToLong(grant -> grant.getGrantedBytes() == null ? 0L : grant.getGrantedBytes()).sum());
                record.getActivePackages().add(summary);
            }
        }
    }

    private void sendGrantNotification(UserStorageQuota quota, StoragePackageEntity storagePackage,
        UserStorageGrant grant, Date now) {
        String addonSize = formatStorageSize(storagePackage.getAddonBytes());
        String totalSize = formatStorageSize(quota.getTotalQuotaBytes());
        Locale locale = LocaleContextHolder.getLocale();
        ByaiNotification notification = new ByaiNotification();
        notification.setId(sequenceService.nextVal());
        notification.setTitle(messageSource.getMessage("storage.quota.notification.granted.title", null, locale));
        notification.setContent(messageSource.getMessage("storage.quota.notification.granted.content",
            new Object[] {storagePackage.getPackageName(), addonSize, totalSize}, locale));
        notification.setBizType(STORAGE_NOTIFICATION_BIZ_TYPE);
        notification.setPriority((short) 2);
        notification.setIsRead("0");
        notification.setResourceBizType(STORAGE_RESOURCE_TYPE);
        notification.setResourceId(quota.getStorageQuotaId());
        notification.setIsDeleted("0");
        notification.setSenderId(currentUserId());
        notification.setTargetId(quota.getUserId());
        notification.setCreateTime(now);

        Map<String, Object> messageValues = new LinkedHashMap<>();
        messageValues.put("packageName", storagePackage.getPackageName());
        messageValues.put("addonBytes", addonSize);
        messageValues.put("totalQuotaBytes", totalSize);
        Map<String, Object> extraInfo = new LinkedHashMap<>();
        extraInfo.put("eventType", "STORAGE_PACKAGE_GRANTED");
        extraInfo.put("titleMessageId", "storageQuota.notification.granted.title");
        extraInfo.put("contentMessageId", "storageQuota.notification.granted.content");
        extraInfo.put("messageValues", messageValues);
        extraInfo.put("grantId", String.valueOf(grant.getGrantId()));
        extraInfo.put("packageId", String.valueOf(storagePackage.getPackageId()));
        notification.setExtraInfo(JSON.toJSONString(extraInfo));
        notificationService.save(notification, false);
    }

    private static String formatStorageSize(Long bytes) {
        long value = bytes == null ? 0L : Math.max(0L, bytes);
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

    private void saveOperation(String requestId, Long userId, String type, String status, Long beforeQuota,
        Long afterQuota, Long beforeUsed, Long afterUsed, Long recycleId, String error) {
        UserStorageOperation operation = new UserStorageOperation();
        operation.setOperationId(sequenceService.nextVal());
        operation.setRequestId(requestId);
        operation.setUserId(userId);
        operation.setOperationType(type);
        operation.setOperationStatus(status);
        operation.setOperatorId(currentUserId());
        operation.setBeforeQuota(beforeQuota);
        operation.setAfterQuota(afterQuota);
        operation.setBeforeUsed(beforeUsed);
        operation.setAfterUsed(afterUsed);
        operation.setRelatedRecycleId(recycleId);
        operation.setErrorMessage(error);
        operation.setCreateTime(new Date());
        if (OP_SUCCESS.equals(status) || OP_FAILED.equals(status)) {
            operation.setFinishTime(new Date());
        }
        operationMapper.insert(operation);
    }

    public long getDefaultQuotaBytes() {
        return getSettings().getDefaultQuotaBytes();
    }

    public int getWarningPercent() {
        return getSettings().getWarningPercent();
    }

    public int getRecycleRetentionDays() {
        return getSettings().getRecycleRetentionDays();
    }

    public int getDowngradeGraceDays() {
        Integer days = getSettings().getDowngradeGraceDays();
        return days == null ? 7 : Math.max(1, days);
    }

    public StorageQuotaSetting getSettings() {
        StorageQuotaSetting setting = settingMapper.selectById(1L);
        if (setting != null) {
            return setting;
        }
        Date now = new Date();
        setting = new StorageQuotaSetting();
        setting.setSettingId(1L);
        setting.setDefaultQuotaBytes(defaultQuotaBytes);
        setting.setWarningPercent(warningPercent);
        setting.setRecycleRetentionDays(7);
        setting.setDowngradeGraceDays(7);
        setting.setCreateBy(currentUserId());
        setting.setCreateTime(now);
        setting.setUpdateBy(currentUserId());
        setting.setUpdateTime(now);
        settingMapper.insert(setting);
        return setting;
    }

    @Transactional(rollbackFor = Exception.class)
    public StorageQuotaSetting updateSettings(StorageQuotaSetting request) {
        if (request == null || request.getDefaultQuotaBytes() == null || request.getDefaultQuotaBytes() <= 0
            || request.getWarningPercent() == null || request.getWarningPercent() <= 0
            || request.getWarningPercent() >= 100 || request.getRecycleRetentionDays() == null
            || request.getRecycleRetentionDays() <= 0
            || (request.getDowngradeGraceDays() != null && request.getDowngradeGraceDays() <= 0)) {
            throw new IllegalArgumentException("默认容量、告警阈值、回收站保留天数和降级宽限天数参数无效");
        }
        StorageQuotaSetting setting = getSettings();
        setting.setDefaultQuotaBytes(request.getDefaultQuotaBytes());
        setting.setWarningPercent(request.getWarningPercent());
        setting.setRecycleRetentionDays(request.getRecycleRetentionDays());
        setting.setDowngradeGraceDays(request.getDowngradeGraceDays() == null
            ? getDowngradeGraceDays() : request.getDowngradeGraceDays());
        setting.setUpdateBy(currentUserId());
        setting.setUpdateTime(new Date());
        settingMapper.updateById(setting);
        return setting;
    }

    private Long currentUserId() {
        return CurrentUserHolder.getCurrentUserId();
    }
}
