package com.iwhalecloud.byai.state.application.service.limit;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.application.service.user.UserTokenQuotaApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.users.UserTokenQuota;
import com.iwhalecloud.byai.manager.mapper.aimodel.ByaiAimodelMapper;
import com.iwhalecloud.byai.state.application.service.langfuse.LangfuseUsageService;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

/**
 * Token 月度限额服务
 * <p>
 * 基于 Langfuse 用量数据实现用户每月公共模型 Token 用量限制。
 * 受限模型: ownerType=PUBLIC 或 sourceType=TOKEN_SERVER
 * </p>
 */
@Service
public class TokenQuotaService {

    private static final Logger log = LoggerFactory.getLogger(TokenQuotaService.class);

    private static final long DEFAULT_MONTHLY_QUOTA = 2_000_000L;

    private static final String BRAND_VERSION_CODE = "BYAI_BRAND_VERSION";

    private static final String COMMERCIAL = "commercial";

    @Autowired
    private ByaiSystemConfigService systemConfigService;

    @Autowired
    private ByaiAimodelMapper byaiAimodelMapper;

    @Autowired
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    @Autowired
    private LangfuseUsageService langfuseUsageService;

    @Autowired
    private UserTokenQuotaApplicationService userTokenQuotaApplicationService;

    /**
     * 检查用户本月 token 额度是否已超限（本月全部模型用量 vs 限额）
     * 商业版本不校验限额。
     *
     * @param userId 用户ID
     * @return true-已超限，false-未超限
     */
    public boolean isQuotaExceeded(Long userId) {
        if (isCommercialVersion()) {
            return false;
        }
        if (userId == null) {
            return false;
        }
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtil.isEmpty(userCode)) {
            return false;
        }
        Map<String, Object> usage = langfuseUsageService.getUserUsage(userCode);
        long used = usage.get("used") != null ? ((Number) usage.get("used")).longValue() : 0L;
        long limit = getMonthlyQuotaLimit(userId);
        return used >= limit;
    }

    /**
     * 判断指定数字员工使用的模型是否受限额约束
     * 通过 resourceId 查询 ss_res_ext_dig_employee 的 prologue 获取 modelId，
     * 再判断: ownerType=PUBLIC 或 sourceType=TOKEN_SERVER 才受限
     * 用户自购个人模型(ownerType=PERSONAL 且 sourceType 为空)不受限
     *
     * @param resourceId 数字员工资源ID (ss_res_ext_dig_employee.resource_id)
     * @return true-受限额约束，false-不受限
     */
    public boolean isModelSubjectToQuota(Long resourceId) {
        if (resourceId == null) {
            return true;
        }
        try {
            SsResExtDigEmployee ext = ssResExtDigEmployeeService.findById(resourceId);
            if (ext == null || StringUtil.isEmpty(ext.getPrologue())) {
                return true;
            }
            JSONObject prologue = JSON.parseObject(ext.getPrologue());
            Long modelId = prologue.getLong("modelId");
            if (modelId == null) {
                return true;
            }
            ByaiAimodel model = byaiAimodelMapper.selectById(modelId);
            if (model == null) {
                return true;
            }
            if ("PUBLIC".equals(model.getOwnerType())) {
                return true;
            }
            if ("TOKEN_SERVER".equals(model.getSourceType())) {
                return true;
            }
            return false;
        } catch (Exception e) {
            log.warn("isModelSubjectToQuota 解析失败, resourceId={}: {}", resourceId, e.getMessage());
            return true;
        }
    }

    /**
     * 获取用户月度限额（优先查用户个人配额表，无记录则回退到系统配置）
     *
     * @param userId 用户ID
     */
    public long getMonthlyQuotaLimit(Long userId) {
        if (userId != null) {
            try {
                UserTokenQuota userQuota = userTokenQuotaApplicationService.getUserQuota(userId);
                if (userQuota != null && userQuota.getMonthlyQuotaLimit() != null && userQuota.getMonthlyQuotaLimit() >= 0) {
                    return userQuota.getMonthlyQuotaLimit();
                }
            } catch (Exception e) {
                log.warn("查询用户个人额度失败, userId={}: {}", userId, e.getMessage());
            }
        }
        return getSystemMonthlyQuotaLimit();
    }

    /**
     * 获取系统级月度限额配置值（从 MODEL_QUOTA JSON 中读取 monthlyQuotaLimit）
     */
    public long getSystemMonthlyQuotaLimit() {
        String json = systemConfigService.getDcSystemConfigValueByCode("MODEL_QUOTA");
        if (StringUtil.isNotEmpty(json)) {
            try {
                JSONObject config = JSON.parseObject(json);
                Long limit = config.getLong("monthlyQuotaLimit");
                if (limit != null && limit > 0) {
                    return limit;
                }
            } catch (Exception e) {
                log.warn("MODEL_QUOTA 配置解析失败: {}", e.getMessage());
            }
        }
        return DEFAULT_MONTHLY_QUOTA;
    }

    /**
     * 获取受限额约束的模型编码集合（公共模型 + TokenServer 个人模型）
     *
     * @param userId 用户ID（用于查询其 TokenServer 模型）
     * @return 受限模型的 modelCode(modelNo) 集合
     */
    public Set<String> getQuotaSubjectModelCodes(Long userId) {
        Set<String> codes = new HashSet<>();

        // 公共模型（status=OOA 启用的）
        LambdaQueryWrapper<ByaiAimodel> publicQuery = new LambdaQueryWrapper<>();
        publicQuery.eq(ByaiAimodel::getOwnerType, "PUBLIC")
                   .eq(ByaiAimodel::getStatus, "OOA")
                   .select(ByaiAimodel::getModelNo);
        List<ByaiAimodel> publicModels = byaiAimodelMapper.selectList(publicQuery);
        for (ByaiAimodel m : publicModels) {
            if (m.getModelNo() != null && !m.getModelNo().isEmpty()) {
                codes.add(m.getModelNo());
            }
        }

        // TokenServer 个人模型
        if (userId != null) {
            LambdaQueryWrapper<ByaiAimodel> tsQuery = new LambdaQueryWrapper<>();
            tsQuery.eq(ByaiAimodel::getCreateBy, userId)
                   .eq(ByaiAimodel::getSourceType, "TOKEN_SERVER")
                   .select(ByaiAimodel::getModelNo);
            List<ByaiAimodel> tsModels = byaiAimodelMapper.selectList(tsQuery);
            for (ByaiAimodel m : tsModels) {
                if (m.getModelNo() != null && !m.getModelNo().isEmpty()) {
                    codes.add(m.getModelNo());
                }
            }
        }

        return codes;
    }

    /**
     * 判断当前是否为商业版本（商业版不校验 Token 限额）
     */
    private boolean isCommercialVersion() {
        String brandVersion = systemConfigService.getDcSystemConfigValueByCode(BRAND_VERSION_CODE);
        return COMMERCIAL.equalsIgnoreCase(brandVersion);
    }
}
