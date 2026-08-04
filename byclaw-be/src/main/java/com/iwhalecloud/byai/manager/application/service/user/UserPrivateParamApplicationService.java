package com.iwhalecloud.byai.manager.application.service.user;

import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.dto.users.UserPrivateParamDTO;
import com.iwhalecloud.byai.manager.entity.users.UserPrivateParam;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper;
import com.iwhalecloud.byai.manager.vo.users.UserPrivateParamVO;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 用户个人参数配置管理。
 *
 * 数据库保存密文；Redis 同步运行期明文缓存，便于外部系统按用户读取。
 * @author qin.guoquan
 * @date 2026-06-22 00:00:00
 */
@Service
public class UserPrivateParamApplicationService {

    private static final Logger log = LoggerFactory.getLogger(UserPrivateParamApplicationService.class);

    private static final String REDIS_KEY_PREFIX = "byai:user:private_params:";

    private static final String NORMAL = "NORMAL";

    private static final String DISABLED = "DISABLED";

    private static final String DELETE_FLAG_NORMAL = "0";

    private static final String DELETE_FLAG_DELETED = "1";

    private static final String PARAM_SOURCE_USER = "USER";

    private static final String PARAM_SOURCE_CONNECTOR = "CONNECTOR";

    private static final Pattern PARAM_KEY_PATTERN = Pattern.compile("[A-Z_][A-Z0-9_]{0,127}");

    @Autowired
    private UserPrivateParamMapper userPrivateParamMapper;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private StringRedisTemplate stringRedisTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private UserService userService;

    @Value("${load.to.redis.batchSize:1000}")
    private Integer syncBatchSize;

    public Map<String, Object> list(UserPrivateParamDTO request) {
        Long userId = currentUserId();
        int pageNum = normalizePageNum(request);
        int pageSize = normalizePageSize(request);
        Page<UserPrivateParam> page = new Page<>(pageNum, pageSize, true);
        userPrivateParamMapper.selectPage(page, buildListQuery(userId, request));
        refreshPrivateParamCache(userId, currentUserCode());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("list", page.getRecords().stream().map(this::toVo).toList());
        result.put("total", page.getTotal());
        result.put("pageNum", page.getCurrent());
        result.put("pageSize", page.getSize());
        return result;
    }

    @Transactional(rollbackFor = Exception.class)
    public UserPrivateParamVO save(UserPrivateParamDTO request) {
        if (request == null) {
            throw new IllegalArgumentException("个人参数配置不能为空");
        }
        Long userId = currentUserId();
        Date now = new Date();
        boolean create = request.getParamId() == null;
        UserPrivateParam entity = create ? new UserPrivateParam() : getOwnedParam(userId, request.getParamId());
        if (!create) {
            assertUserManaged(entity);
        }
        validateSaveRequest(request);
        String nextKey = normalizeKey(request.getKey());
        ensureKeyUnique(userId, nextKey, create ? null : entity.getParamId());

        if (create) {
            entity.setParamId(sequenceService.nextVal());
            entity.setUserId(userId);
            entity.setCreateBy(userId);
            entity.setCreateTime(now);
            entity.setDeleteFlag(DELETE_FLAG_NORMAL);
            entity.setParamSource(PARAM_SOURCE_USER);
            entity.setSourceRef(null);
        }

        entity.setParamKey(nextKey);
        entity.setDescription(StringUtils.trimToEmpty(request.getDescription()));
        entity.setStatus(Boolean.FALSE.equals(request.getEnabled()) ? DISABLED : NORMAL);
        entity.setUpdateBy(userId);
        entity.setUpdateTime(now);

        String value = StringUtils.trimToEmpty(request.getValue());
        if (StringUtils.isNotBlank(value)) {
            entity.setParamValueCipher(Sm4Util.encrypt(value));
            entity.setParamValueLast4(last4(value));
        }
        else if (create) {
            throw new IllegalArgumentException("新增个人参数时参数值不能为空");
        }

        if (create) {
            userPrivateParamMapper.insert(entity);
        }
        else {
            userPrivateParamMapper.updateById(entity);
        }
        refreshPrivateParamCacheAfterCommit(userId, currentUserCode());
        return toVo(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    public Boolean delete(UserPrivateParamDTO request) {
        Long paramId = request == null ? null : request.getParamId();
        if (paramId == null) {
            throw new IllegalArgumentException("个人参数ID不能为空");
        }
        Long userId = currentUserId();
        UserPrivateParam param = getOwnedParam(userId, paramId);
        assertUserManaged(param);
        Date now = new Date();
        UserPrivateParam update = new UserPrivateParam();
        update.setParamId(param.getParamId());
        update.setStatus(DISABLED);
        update.setDeleteFlag(DELETE_FLAG_DELETED);
        update.setUpdateBy(userId);
        update.setUpdateTime(now);
        userPrivateParamMapper.updateById(update);
        refreshPrivateParamCacheAfterCommit(userId, currentUserCode());
        return Boolean.TRUE;
    }

    @Transactional(rollbackFor = Exception.class)
    public UserPrivateParamVO enable(UserPrivateParamDTO request) {
        Long paramId = request == null ? null : request.getParamId();
        if (paramId == null) {
            throw new IllegalArgumentException("个人参数ID不能为空");
        }
        Long userId = currentUserId();
        UserPrivateParam param = getOwnedParam(userId, paramId);
        assertUserManaged(param);
        Date now = new Date();
        String nextStatus = Boolean.FALSE.equals(request.getEnabled()) ? DISABLED : NORMAL;
        UserPrivateParam update = new UserPrivateParam();
        update.setParamId(param.getParamId());
        update.setStatus(nextStatus);
        update.setUpdateBy(userId);
        update.setUpdateTime(now);
        userPrivateParamMapper.updateById(update);
        param.setStatus(nextStatus);
        param.setUpdateTime(now);
        refreshPrivateParamCacheAfterCommit(userId, currentUserCode());
        return toVo(param);
    }

    /**
     * 服务启动后全量重建个人参数运行期数据，避免 DB 与 Redis 数据不一致。
     */
    @Async
    public void syncAllPrivateParamCache() {
        long start = System.currentTimeMillis();
        int pageSize = syncBatchSize == null || syncBatchSize <= 0 ? 1000 : syncBatchSize;
        int successCount = 0;
        int failCount = 0;
        int skippedCount = 0;
        log.info("开始异步全量同步用户个人参数配置到Redis");

        for (int pageIndex = 1; true; pageIndex++) {
            Page<UserPrivateParam> page = new Page<>(pageIndex, pageSize, false);
            List<Long> userIds = userPrivateParamMapper.selectPage(page, new LambdaQueryWrapper<UserPrivateParam>()
                    .select(UserPrivateParam::getUserId)
                    .groupBy(UserPrivateParam::getUserId)
                    .orderByAsc(UserPrivateParam::getUserId))
                .getRecords()
                .stream()
                .map(UserPrivateParam::getUserId)
                .toList();

            if (userIds.isEmpty()) {
                break;
            }

            for (Long userId : userIds) {
                try {
                    Users user = userService.findById(userId);
                    if (user == null || StringUtils.isBlank(user.getUserCode())) {
                        skippedCount++;
                        log.warn("同步用户个人参数配置到Redis跳过，userId={} 用户不存在或userCode为空", userId);
                        continue;
                    }
                    refreshPrivateParamCache(userId, user.getUserCode());
                    successCount++;
                }
                catch (Exception ex) {
                    failCount++;
                    log.warn("同步用户个人参数配置到Redis失败，userId={}，reason={}", userId, ex.getMessage(), ex);
                }
            }

            log.info("全量同步用户个人参数配置到Redis进度：pageIndex={}，本页{}个用户，累计成功{}，失败{}，跳过{}",
                pageIndex, userIds.size(), successCount, failCount, skippedCount);

            if (userIds.size() < pageSize) {
                break;
            }
        }

        long costMs = System.currentTimeMillis() - start;
        log.info("异步全量同步用户个人参数配置到Redis完成，成功{}，失败{}，跳过{}，耗时{}ms",
            successCount, failCount, skippedCount, costMs);
    }

    private List<UserPrivateParam> listParams(Long userId) {
        return userPrivateParamMapper.selectList(baseQuery(userId)
            .orderByDesc(UserPrivateParam::getUpdateTime)
            .orderByDesc(UserPrivateParam::getCreateTime));
    }

    private LambdaQueryWrapper<UserPrivateParam> buildListQuery(Long userId, UserPrivateParamDTO request) {
        LambdaQueryWrapper<UserPrivateParam> query = baseQuery(userId);
        String keyword = request == null ? "" : StringUtils.trimToEmpty(request.getKeyword());
        if (StringUtils.isNotBlank(keyword)) {
            query.and(wrapper -> wrapper
                .like(UserPrivateParam::getParamKey, keyword)
                .or()
                .like(UserPrivateParam::getDescription, keyword));
        }

        String status = normalizeStatus(request == null ? null : request.getStatus());
        if (StringUtils.isNotBlank(status)) {
            query.eq(UserPrivateParam::getStatus, status);
        }

        if (isAscSort(request == null ? null : request.getUpdateTimeSort())) {
            query.orderByAsc(UserPrivateParam::getUpdateTime);
        }
        else {
            query.orderByDesc(UserPrivateParam::getUpdateTime);
        }
        return query.orderByDesc(UserPrivateParam::getCreateTime);
    }

    private LambdaQueryWrapper<UserPrivateParam> baseQuery(Long userId) {
        return new LambdaQueryWrapper<UserPrivateParam>()
            .eq(UserPrivateParam::getUserId, userId)
            .eq(UserPrivateParam::getDeleteFlag, DELETE_FLAG_NORMAL);
    }

    private UserPrivateParam getOwnedParam(Long userId, Long paramId) {
        UserPrivateParam param = userPrivateParamMapper.selectOne(baseQuery(userId)
            .eq(UserPrivateParam::getParamId, paramId));
        if (param == null) {
            throw new IllegalArgumentException("个人参数不存在或无权限访问");
        }
        return param;
    }

    private void validateSaveRequest(UserPrivateParamDTO request) {
        if (request == null) {
            throw new IllegalArgumentException("个人参数配置不能为空");
        }
        String key = normalizeKey(request.getKey());
        if (!PARAM_KEY_PATTERN.matcher(key).matches()) {
            throw new IllegalArgumentException("参数名必须符合环境变量格式：[A-Z_][A-Z0-9_]{0,127}");
        }
    }

    private String normalizeKey(String key) {
        return StringUtils.trimToEmpty(key).toUpperCase();
    }

    private String normalizeStatus(String status) {
        String normalized = StringUtils.trimToEmpty(status).toUpperCase();
        return NORMAL.equals(normalized) || DISABLED.equals(normalized) ? normalized : "";
    }

    private int normalizePageNum(UserPrivateParamDTO request) {
        Integer pageNum = request == null ? null : request.getPageNum();
        return pageNum == null || pageNum <= 0 ? 1 : pageNum;
    }

    private int normalizePageSize(UserPrivateParamDTO request) {
        Integer pageSize = request == null ? null : request.getPageSize();
        if (pageSize == null || pageSize <= 0) {
            return 10;
        }
        return Math.min(pageSize, 100);
    }

    private boolean isAscSort(String updateTimeSort) {
        String sort = StringUtils.trimToEmpty(updateTimeSort);
        return "ascend".equalsIgnoreCase(sort) || "asc".equalsIgnoreCase(sort);
    }

    private void ensureKeyUnique(Long userId, String key, Long currentParamId) {
        LambdaQueryWrapper<UserPrivateParam> query = baseQuery(userId)
            .eq(UserPrivateParam::getParamKey, key);
        if (currentParamId != null) {
            query.ne(UserPrivateParam::getParamId, currentParamId);
        }
        Long count = userPrivateParamMapper.selectCount(query);
        if (count != null && count > 0) {
            throw new IllegalArgumentException("参数名已存在");
        }
    }

    private UserPrivateParamVO toVo(UserPrivateParam param) {
        UserPrivateParamVO vo = new UserPrivateParamVO();
        vo.setParamId(param.getParamId());
        vo.setKey(param.getParamKey());
        vo.setDescription(param.getDescription());
        vo.setStatus(param.getStatus());
        vo.setEnabled(NORMAL.equals(param.getStatus()));
        vo.setHasValue(StringUtils.isNotBlank(param.getParamValueCipher()));
        vo.setValueLast4(param.getParamValueLast4());
        vo.setUpdateTime(param.getUpdateTime());
        String source = StringUtils.defaultIfBlank(param.getParamSource(), PARAM_SOURCE_USER);
        boolean managed = PARAM_SOURCE_CONNECTOR.equals(source);
        vo.setSource(source);
        vo.setSourceRef(param.getSourceRef());
        vo.setManaged(managed);
        vo.setEditable(!managed);
        vo.setDeletable(!managed);
        vo.setEnableable(!managed);
        return vo;
    }

    private void assertUserManaged(UserPrivateParam param) {
        if (param != null && PARAM_SOURCE_CONNECTOR.equals(param.getParamSource())) {
            throw new IllegalArgumentException("系统托管连接器参数不允许用户修改");
        }
    }

    private Long currentUserId() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || userId <= 0) {
            throw new IllegalStateException("当前用户未登录");
        }
        return userId;
    }

    private String currentUserCode() {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalStateException("当前用户编码为空");
        }
        return userCode;
    }

    private void refreshPrivateParamCache(Long userId, String userCode) {
        refreshPrivateParamCache(userId, userCode, listParams(userId));
    }

    /** 在当前数据库事务提交后刷新缓存；无事务调用时立即刷新。 */
    public void refreshPrivateParamCacheAfterCommit(Long userId, String userCode) {
        if (TransactionSynchronizationManager.isActualTransactionActive()
                && TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    refreshPrivateParamCache(userId, userCode);
                }
            });
            return;
        }
        refreshPrivateParamCache(userId, userCode);
    }

    private void refreshPrivateParamCache(Long userId, String userCode, List<UserPrivateParam> params) {
        try {
            Map<String, String> activeParams = buildActiveParamMap(params);
            String redisKey = buildPrivateParamRedisKey(userCode);
            if (activeParams.isEmpty()) {
                stringRedisTemplate.delete(redisKey);
                return;
            }
            stringRedisTemplate.opsForValue().set(redisKey, buildPrivateParamCacheJson(activeParams));
        }
        catch (Exception ex) {
            log.warn("同步用户个人参数配置到Redis失败，userId={}，userCode={}，reason={}", userId, userCode, ex.getMessage(), ex);
        }
    }

    private Map<String, String> buildActiveParamMap(List<UserPrivateParam> params) {
        Map<String, String> activeParams = new LinkedHashMap<>();
        for (UserPrivateParam param : params) {
            if (!NORMAL.equals(param.getStatus()) || StringUtils.isBlank(param.getParamValueCipher())) {
                continue;
            }
            String value = decryptValue(param);
            if (StringUtils.isNotEmpty(value)) {
                activeParams.put(param.getParamKey(), value);
            }
        }
        return activeParams;
    }

    private String buildPrivateParamCacheJson(Map<String, String> params) throws JsonProcessingException {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("version", System.currentTimeMillis());
        root.put("updated_at", OffsetDateTime.now().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME));
        root.put("params", params);
        return objectMapper.writeValueAsString(root);
    }

    private String decryptValue(UserPrivateParam param) {
        try {
            return Sm4Util.decrypt(param.getParamValueCipher());
        }
        catch (Exception ex) {
            log.warn("个人参数值解密失败，paramId={}，reason={}", param.getParamId(), ex.getMessage());
            return "";
        }
    }

    private String last4(String value) {
        if (StringUtils.isBlank(value)) {
            return "";
        }
        return value.length() <= 4 ? value : value.substring(value.length() - 4);
    }

    public static String buildPrivateParamRedisKey(String userCode) {
        return REDIS_KEY_PREFIX + userCode;
    }
}
