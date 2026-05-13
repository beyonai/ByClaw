package com.iwhalecloud.byai.manager.application.service.operations;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.domain.operations.service.OperationsQueryService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtEvaluateService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtTestSetService;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.entity.monitor.MonitorTarget;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtEvaluate;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtTestSet;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.monitor.MonitorTargetMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.vo.resource.SsResExtEvaluateCompareVO;
import com.iwhalecloud.byai.manager.vo.resource.SsResExtEvaluateVO;
import com.iwhalecloud.byai.common.message.service.ByaiMessageRelObjService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;


import static com.iwhalecloud.byai.common.constants.queryconfig.QueryConfigCodeEnum.DIG_EMPLOYEE_EVALUATE_METRICS;
import static com.iwhalecloud.byai.common.constants.resource.EvaluateType.TEST_SET_ACCURACY;
import static com.iwhalecloud.byai.common.constants.resource.EvaluateType.CONVERSATION_ERROR_RATE;
import static com.iwhalecloud.byai.common.constants.resource.EvaluateType.AVG_FIRST_RESPONSE_DURATION;
import static com.iwhalecloud.byai.common.constants.resource.EvaluateType.PERSONA_SPECIFICATION_SCORE;
import static com.iwhalecloud.byai.common.constants.resource.EvaluateType.ABILITY_POST_MATCHING_SCORE;
import static com.iwhalecloud.byai.common.constants.resource.EvaluateType.ACTUAL_USE_ACCURACY;

/**
 * 数字员工评估管理器 负责评估逻辑的处理和比对
 *
 * @author zzh
 */
@Component
public class EvaluationManager {
    private final Logger logger = LoggerFactory.getLogger(getClass());

    // 国际化消息key常量
    private static final String EVALUATION_QUALIFIED = "evaluation.result.qualified";
    private static final String ABILITY_MATCH_FAILED = "evaluation.result.ability.match.failed";
    private static final String PERSONA_SPEC_FAILED = "evaluation.result.persona.spec.failed";
    private static final String RESPONSE_TIME_FAILED = "evaluation.result.response.time.failed";
    private static final String ERROR_RATE_FAILED = "evaluation.result.error.rate.failed";
    private static final String TEST_ACCURACY_FAILED = "evaluation.result.test.accuracy.failed";
    private static final String ACTUAL_ACCURACY_FAILED = "evaluation.result.actual.accuracy.failed";

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private SystemConfigService systemConfigService;

    @Autowired
    private SsResExtEvaluateService ssResExtEvaluateService;

    @Autowired
    private OperationsQueryService operationsQueryService;

    @Autowired
    private ByaiMessageRelObjService byaiMessageRelObjService;

    @Autowired
    private SsResExtTestSetService ssResExtTestSetService;

    @Autowired
    private MonitorTargetMapper monitorTargetMapper;

    /**
     * 立即评估
     *
     * @param resourceId 资源ID
     * @return 立即评估结果
     */
    public SsResExtEvaluateCompareVO immediatelyEvaluate(Long resourceId) {
        // 获取数字员工判断是否存在
        validateResource(resourceId);

        // 创建比对对象
        SsResExtEvaluateCompareVO compareVO = new SsResExtEvaluateCompareVO(resourceId);

        // 获取评估配置映射
        Map<String, Object> evaluateConfigMap = getEvaluateConfigMap();

        // 设置基准值
        setStandardValues(compareVO.getStandardVO(), evaluateConfigMap);

        // 设置评估值（暂时使用默认值，后续todo实现具体评估逻辑）
        setEvaluateValues(compareVO.getEvaluateVO());

        // 进行比对判断是否符合要求
        evaluateMatch(compareVO);
        // 入库这次的评估值
        SsResExtEvaluate ssResExtEvaluate = new SsResExtEvaluate();
        BeanUtils.copyProperties(compareVO.getEvaluateVO(), ssResExtEvaluate);
        ssResExtEvaluate.setCreateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        ssResExtEvaluate.setIsQualifiedForPost(compareVO.getIsQualifiedForPost());
        ssResExtEvaluate.setEvaluateResult(compareVO.getEvaluateResult());
        ssResExtEvaluate.setCreateTime(LocalDateTime.now());
        ssResExtEvaluate.setUpdateTime(LocalDateTime.now());
        ssResExtEvaluateService.saveOrUpdate(ssResExtEvaluate);

        return compareVO;
    }

    /**
     * 评估比对逻辑 并设置评估结果
     *
     * @param compareVO 包含评估值和基准值
     */
    public void evaluateMatch(SsResExtEvaluateCompareVO compareVO) {
        SsResExtEvaluateVO evaluateVO = compareVO.getEvaluateVO();
        SsResExtEvaluateVO standardVO = compareVO.getStandardVO();

        // 检查各项评估指标是否符合要求
        StringBuilder evaluateResult = new StringBuilder();

        boolean abilityMatch = checkAbilityMatch(evaluateVO, standardVO, evaluateResult);
        boolean personaMatch = checkPersonaMatch(evaluateVO, standardVO, evaluateResult);
        boolean responseTimeMatch = checkResponseTimeMatch(evaluateVO, standardVO, evaluateResult);
        boolean errorRateMatch = checkErrorRateMatch(evaluateVO, standardVO, evaluateResult);
        boolean testAccuracyMatch = checkTestAccuracyMatch(evaluateVO, standardVO, evaluateResult);
        boolean actualAccuracyMatch = checkActualAccuracyMatch(evaluateVO, standardVO, evaluateResult);

        // 全部符合要求才返回true
        boolean isMatch = abilityMatch && personaMatch && responseTimeMatch && errorRateMatch && testAccuracyMatch
            && actualAccuracyMatch;

        // 设置评估结果详情
        if (isMatch) {
            // 所有指标都符合要求
            compareVO.setIsQualifiedForPost(1);
            compareVO.setEvaluateResult(I18nUtil.get(EVALUATION_QUALIFIED));
        }
        else {
            // 有指标不符合要求
            compareVO.setIsQualifiedForPost(0);
            // 移除最后一个分号
            if (!evaluateResult.isEmpty()) {
                evaluateResult.setLength(evaluateResult.length() - 1);
            }
            compareVO.setEvaluateResult(evaluateResult.toString());
        }
    }

    /**
     * 判断资源是否存在
     *
     * @param resourceId 资源ID
     */
    private void validateResource(Long resourceId) {
        SsResource ssResource = ssResourceMapper.selectById(resourceId);
        if (ssResource == null) {
            throw new BaseException("resource.not.found");
        }
    }

    /**
     * 获取评估配置映射
     *
     * @return 评估配置映射，key为param_code，value为param_value
     */
    private Map<String, Object> getEvaluateConfigMap() {
        List<String> evaluateTypeCodeList = List.of(
            TEST_SET_ACCURACY.getCode(),
            ACTUAL_USE_ACCURACY.getCode(), 
            CONVERSATION_ERROR_RATE.getCode(),
            AVG_FIRST_RESPONSE_DURATION.getCode(), 
            PERSONA_SPECIFICATION_SCORE.getCode(),
            ABILITY_POST_MATCHING_SCORE.getCode()
        );
        return systemConfigService.findParamValueMapByCodes(evaluateTypeCodeList);
    }

    /**
     * 设置基准值
     *
     * @param standardVO 基准值VO
     * @param configMap 配置映射
     */
    private void setStandardValues(SsResExtEvaluateVO standardVO, Map<String, Object> configMap) {
        standardVO.setTestSetAccuracy(parseBigDecimal((String) configMap.get(TEST_SET_ACCURACY.getCode())));
        standardVO.setActualUseAccuracy(parseBigDecimal((String) configMap.get(ACTUAL_USE_ACCURACY.getCode())));
        standardVO.setConversationErrorRate(parseBigDecimal((String) configMap.get(CONVERSATION_ERROR_RATE.getCode())));
        standardVO.setAvgFirstResponseDuration(parseBigDecimal((String) configMap.get(AVG_FIRST_RESPONSE_DURATION.getCode())));
        standardVO.setPersonaSpecificationScore(parseBigDecimal((String) configMap.get(PERSONA_SPECIFICATION_SCORE.getCode())));
        standardVO.setAbilityPostMatchingScore(parseBigDecimal((String) configMap.get(ABILITY_POST_MATCHING_SCORE.getCode())));
    }

    /**
     * 构建评估指标参数 获取对话异常率、平均首词响应时长
     *
     * @return Map<String, Object>
     */
    private Map<String, Object> buildEvaluateParams(Long resourceId) {
        Map<String, Object> params = new HashMap<>();
        params.put("resourceId", String.valueOf(resourceId));
        params.put("resObjType", "AGENT");
        return params;
    }


    /**
     * 设置评估值
     *
     * @param evaluateVO 评估值VO
     */
    private void setEvaluateValues(SsResExtEvaluateVO evaluateVO) {
        // 获取对话异常率、平均首词响应时长、实际使用回复准确率
        Map<String, Object> params = buildEvaluateParams(evaluateVO.getResourceId());
        String processedConfigJson = operationsQueryService
                .getMetricESConfigJson(DIG_EMPLOYEE_EVALUATE_METRICS.getCode(), params);
        Map<String, Object> data = byaiMessageRelObjService.queryMetricsByConfig(processedConfigJson);
        setTechnicalEvaluateValues(evaluateVO, data);

        // 获取最新的测试集评估结果 (测试集准确率)
        SsResExtTestSet ssResExtTestSet = ssResExtTestSetService.findLatestByResourceId(evaluateVO.getResourceId());
        if (ssResExtTestSet != null) {
            evaluateVO.setTestSetAccuracy(ssResExtTestSet.getTestSetAccuracy());
        }

        // 获取 人设描述规范度
        LambdaQueryWrapper<MonitorTarget> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(MonitorTarget::getAgentId, evaluateVO.getResourceId());
        wrapper.eq(MonitorTarget::getTargetType, "agent");
        List<MonitorTarget> monitorTargets = monitorTargetMapper.selectList(wrapper);
        if (!CollectionUtils.isEmpty(monitorTargets)) {
            String targetQuality = monitorTargets.get(0).getTargetQuality();
            double score = Double.parseDouble(targetQuality);
            // 计算 personaSpecificationScore: (score / 5.0) * 100%，保留两位小数
            double personaScore = score / 5.0 * 100.0;
            personaScore = Math.round(personaScore * 100.0) / 100.0;
            evaluateVO.setPersonaSpecificationScore(BigDecimal.valueOf(personaScore));
        }

        // 获取 能力与描述岗位匹配度todo
        evaluateVO.setAbilityPostMatchingScore(BigDecimal.valueOf(90.0));
    }


    /**
     * 设置技术指标值
     *
     * @param evaluateVO 评估对象
     * @param data 获取的指标数据
     */
    private void setTechnicalEvaluateValues(SsResExtEvaluateVO evaluateVO, Map<String, Object> data) {
        if (data == null) {
            logger.error("获取技术性指标数据为空");
            return;
        }
        Double avgFirstTextDuration = getDoubleValue(data.get("avgFirstTextDuration"));
        Double totalCount = getDoubleValue(data.get("totalCount"));
        Map<String, Object> errorCount = (Map<String, Object>) data.get("errorCount");
        Map<String, Object> treadCount = (Map<String, Object>) data.get("treadCount");

        // 处理平均首词响应时长，保留两位小数
        double roundedDuration = Math.round(avgFirstTextDuration * 100.0) / 100.0;
        evaluateVO.setAvgFirstResponseDuration(BigDecimal.valueOf(roundedDuration));

        // 处理对话异常率
        double errorRate = 0.0;
        if (errorCount != null) {
            Double docCount = getDoubleValue(errorCount.get("docCount"));
            // 计算对话异常率，避免除零错误
            if (totalCount > 0) {
                errorRate = docCount / totalCount * 100.0;
                // 保留两位小数
                errorRate = Math.round(errorRate * 100.0) / 100.0;
            }
        }
        evaluateVO.setConversationErrorRate(BigDecimal.valueOf(errorRate));

        // 处理实际使用回复准确率
        double actualUseAccuracy = 0.0;
        if (treadCount != null) {
            Double docCount = getDoubleValue(treadCount.get("docCount"));
            // 计算实际使用回复准确率，避免除零错误
            if (totalCount > 0) {
                actualUseAccuracy = (totalCount - docCount) * 100.0 / totalCount;
                actualUseAccuracy = Math.round(actualUseAccuracy * 100.0) / 100.0;
            }
        }
        evaluateVO.setActualUseAccuracy(BigDecimal.valueOf(actualUseAccuracy));
    }

    /**
     * 安全地将Object转换为Double
     *
     * @param value 要转换的值
     * @return 转换后的Double值，如果转换失败返回0.0
     */
    private Double getDoubleValue(Object value) {
        if (value == null) {
            return 0.0;
        }
        try {
            if (value instanceof Number) {
                return ((Number) value).doubleValue();
            }
            else if (value instanceof String) {
                return Double.parseDouble((String) value);
            }
        }
        catch (Exception e) {
            logger.warn("转换Double值失败: {}, 类型: {}", value, value.getClass(), e);
        }
        return 0.0;
    }


    /**
     * 检查能力描述与岗位匹配度是否符合要求
     */
    private boolean checkAbilityMatch(SsResExtEvaluateVO evaluateVO, SsResExtEvaluateVO standardVO, StringBuilder evaluateResult) {
        boolean isMatch = evaluateVO.getAbilityPostMatchingScore() != null
            && standardVO.getAbilityPostMatchingScore() != null
            && evaluateVO.getAbilityPostMatchingScore().compareTo(standardVO.getAbilityPostMatchingScore()) >= 0;

        if (!isMatch) {
            evaluateResult.append(I18nUtil.get(ABILITY_MATCH_FAILED, standardVO.getAbilityPostMatchingScore())).append(";").append("\n");
        }
        return isMatch;
    }

    /**
     * 检查人设描述规范度是否符合要求
     */
    private boolean checkPersonaMatch(SsResExtEvaluateVO evaluateVO, SsResExtEvaluateVO standardVO, StringBuilder evaluateResult) {
        boolean isMatch = evaluateVO.getPersonaSpecificationScore() != null
            && standardVO.getPersonaSpecificationScore() != null
            && evaluateVO.getPersonaSpecificationScore().compareTo(standardVO.getPersonaSpecificationScore()) >= 0;

        if (!isMatch) {
            evaluateResult.append(I18nUtil.get(PERSONA_SPEC_FAILED, standardVO.getPersonaSpecificationScore())).append(";").append("\n");
        }
        return isMatch;
    }

    /**
     * 检查平均首词响应时长是否符合要求
     */
    private boolean checkResponseTimeMatch(SsResExtEvaluateVO evaluateVO, SsResExtEvaluateVO standardVO, StringBuilder evaluateResult) {
        boolean isMatch = evaluateVO.getAvgFirstResponseDuration() != null
            && standardVO.getAvgFirstResponseDuration() != null
            && evaluateVO.getAvgFirstResponseDuration().compareTo(standardVO.getAvgFirstResponseDuration()) <= 0;

        if (!isMatch) {
            evaluateResult.append(I18nUtil.get(RESPONSE_TIME_FAILED, standardVO.getAvgFirstResponseDuration())).append(";").append("\n");
        }
        return isMatch;
    }

    /**
     * 检查对话异常率是否符合要求
     */
    private boolean checkErrorRateMatch(SsResExtEvaluateVO evaluateVO, SsResExtEvaluateVO standardVO, StringBuilder evaluateResult) {
        boolean isMatch = evaluateVO.getConversationErrorRate() != null && standardVO.getConversationErrorRate() != null
            && evaluateVO.getConversationErrorRate().compareTo(standardVO.getConversationErrorRate()) <= 0;

        if (!isMatch) {
            evaluateResult.append(I18nUtil.get(ERROR_RATE_FAILED, standardVO.getConversationErrorRate())).append(";").append("\n");
        }
        return isMatch;
    }

    /**
     * 检查测试集回答准确率是否符合要求
     */
    private boolean checkTestAccuracyMatch(SsResExtEvaluateVO evaluateVO, SsResExtEvaluateVO standardVO, StringBuilder evaluateResult) {
        boolean isMatch = evaluateVO.getTestSetAccuracy() != null && standardVO.getTestSetAccuracy() != null
            && evaluateVO.getTestSetAccuracy().compareTo(standardVO.getTestSetAccuracy()) >= 0;

        if (!isMatch) {
            evaluateResult.append(I18nUtil.get(TEST_ACCURACY_FAILED, standardVO.getTestSetAccuracy())).append(";").append("\n");
        }
        return isMatch;
    }

    /**
     * 检查实际使用回复准确率是否符合要求
     */
    private boolean checkActualAccuracyMatch(SsResExtEvaluateVO evaluateVO, SsResExtEvaluateVO standardVO, StringBuilder evaluateResult) {
        boolean isMatch = evaluateVO.getActualUseAccuracy() != null && standardVO.getActualUseAccuracy() != null
            && evaluateVO.getActualUseAccuracy().compareTo(standardVO.getActualUseAccuracy()) >= 0;

        if (!isMatch) {
            evaluateResult.append(I18nUtil.get(ACTUAL_ACCURACY_FAILED, standardVO.getActualUseAccuracy())).append(";").append("\n");
        }
        return isMatch;
    }

    /**
     * 安全地将字符串转换为BigDecimal
     *
     * @param value 字符串值
     * @return BigDecimal对象，转换失败返回null
     */
    private BigDecimal parseBigDecimal(String value) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }
        try {
            return new BigDecimal(value.trim());
        }
        catch (NumberFormatException e) {
            return null;
        }
    }
}