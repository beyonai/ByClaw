package com.iwhalecloud.byai.manager.application.service.user;

import java.util.Date;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.entity.users.UserTokenQuota;
import com.iwhalecloud.byai.manager.mapper.users.UserTokenQuotaMapper;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 用户Token额度配置管理。
 */
@Service
public class UserTokenQuotaApplicationService {

    private static final String DELETE_FLAG_NORMAL = "0";

    private static final long DEFAULT_MONTHLY_QUOTA = 2_000_000L;

    @Autowired
    private UserTokenQuotaMapper userTokenQuotaMapper;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private ByaiSystemConfigService systemConfigService;

    /**
     * 查询用户个人额度配置，无记录返回 null。
     */
    public UserTokenQuota getUserQuota(Long userId) {
        if (userId == null) {
            return null;
        }
        return userTokenQuotaMapper.selectOne(baseQuery(userId));
    }

    /**
     * 分配/更新用户Token额度（upsert）。
     */
    @Transactional(rollbackFor = Exception.class)
    public void assignQuota(Long userId, Long monthlyQuotaLimit, String remark) {
        if (userId == null || monthlyQuotaLimit == null) {
            throw new IllegalArgumentException("userId和monthlyQuotaLimit不能为空");
        }
        if (monthlyQuotaLimit < 0) {
            throw new IllegalArgumentException("月度额度不能小于0");
        }

        Long operatorId = CurrentUserHolder.getCurrentUserId();
        Date now = new Date();

        UserTokenQuota existing = getUserQuota(userId);
        if (existing != null) {
            existing.setMonthlyQuotaLimit(monthlyQuotaLimit);
            existing.setRemark(remark);
            existing.setUpdateBy(operatorId);
            existing.setUpdateTime(now);
            userTokenQuotaMapper.updateById(existing);
        } else {
            UserTokenQuota entity = new UserTokenQuota();
            entity.setQuotaId(sequenceService.nextVal());
            entity.setUserId(userId);
            entity.setMonthlyQuotaLimit(monthlyQuotaLimit);
            entity.setRemark(remark);
            entity.setCreateBy(operatorId);
            entity.setCreateTime(now);
            entity.setUpdateBy(operatorId);
            entity.setUpdateTime(now);
            entity.setDeleteFlag(DELETE_FLAG_NORMAL);
            userTokenQuotaMapper.insert(entity);
        }
    }

    private LambdaQueryWrapper<UserTokenQuota> baseQuery(Long userId) {
        return new LambdaQueryWrapper<UserTokenQuota>()
            .eq(UserTokenQuota::getUserId, userId)
            .eq(UserTokenQuota::getDeleteFlag, DELETE_FLAG_NORMAL);
    }

    /**
     * 获取系统默认月度限额（从 MODEL_QUOTA 配置读取）
     */
    public long getSystemDefaultQuota() {
        String json = systemConfigService.getDcSystemConfigValueByCode("MODEL_QUOTA");
        if (StringUtil.isNotEmpty(json)) {
            try {
                JSONObject config = JSON.parseObject(json);
                Long limit = config.getLong("monthlyQuotaLimit");
                if (limit != null && limit > 0) {
                    return limit;
                }
            } catch (Exception ignored) {
            }
        }
        return DEFAULT_MONTHLY_QUOTA;
    }
}
