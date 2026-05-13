package com.iwhalecloud.byai.manager.application.service.operations;

import com.iwhalecloud.byai.manager.domain.position.service.PositionService;
import com.iwhalecloud.byai.manager.domain.position.service.PositionUserRelationService;
import com.iwhalecloud.byai.manager.domain.position.service.ResourcePositionRelationService;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Date;
import java.util.HashMap;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.Set;
import java.util.stream.Collectors;
import com.alibaba.fastjson.JSONException;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.google.common.collect.Lists;
import com.iwhalecloud.byai.manager.application.service.files.FilesApplicationService;
import com.iwhalecloud.byai.manager.domain.auth.enums.Color;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantType;
import com.iwhalecloud.byai.manager.domain.auth.enums.MessageContentTypeEnum;
import com.iwhalecloud.byai.manager.domain.auth.enums.OperType;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtEvaluateService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtTestSetService;
import com.iwhalecloud.byai.manager.domain.conversation.service.FeedbackMsgInfoService;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.dto.file.UploadFilesRespDto;
import com.iwhalecloud.byai.manager.dto.operations.MessageRelObjMetricsRequest;
import com.iwhalecloud.byai.manager.dto.operations.OperationResourceTestSetRequest;
import com.iwhalecloud.byai.manager.dto.operations.MessageFeedbackAssignRequest;
import com.iwhalecloud.byai.manager.dto.operations.ApplyPostRequest;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.conversation.FeedbackMsgInfo;
import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.entity.position.PositionExtCatalog;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtTestSet;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceCatalog;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.message.service.ByaiMessageRelObjService;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.mapper.position.PositionExtCatalogMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceCatalogMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtEvaluate;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.resource.BatchStatus;
import com.iwhalecloud.byai.common.constants.resource.EvaluateTestSetType;
import com.iwhalecloud.byai.common.constants.resource.EvaluateType;
import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.manager.vo.resource.SsResExtEvaluateVO;
import com.iwhalecloud.byai.manager.vo.resource.SsResExtEvaluateCompareVO;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.feign.client.FeignPythonToolService;
import com.iwhalecloud.byai.common.feign.request.conversation.McpServer;
import com.iwhalecloud.byai.common.feign.request.conversation.TodoRequestDTO;
import com.iwhalecloud.byai.common.feign.response.knowledge.McpServerDto;
import com.iwhalecloud.byai.common.feign.response.python.BatchProgressResponse;
import com.iwhalecloud.byai.common.storage.util.MultipartFileUtil;
import com.iwhalecloud.byai.manager.qo.resource.SsResExtTestSetQo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.resource.SsResExtTestSetVo;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;
import com.iwhalecloud.byai.manager.domain.operations.service.OperationsQueryService;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.vo.operations.DigEmployeeOperationsVO;
import com.iwhalecloud.byai.manager.vo.operations.RelResourceVO;
import static com.iwhalecloud.byai.common.constants.queryconfig.QueryConfigCodeEnum.DIG_EMPLOYEE_USAGE_METRICS;
import static com.iwhalecloud.byai.common.constants.queryconfig.QueryConfigCodeEnum.DIG_EMPLOYEE_TECHNICAL_METRICS;
import static com.iwhalecloud.byai.common.constants.queryconfig.QueryConfigCodeEnum.DIG_EMPLOYEE_ACCURACY_METRICS;
import static com.iwhalecloud.byai.common.constants.resource.EvaluateType.TEST_SET_ACCURACY;
import static com.iwhalecloud.byai.common.constants.Constants.ResourceBizType.AGENT;
import static com.iwhalecloud.byai.common.constants.Constants.ResourceBizType.DIG_EMPLOYEE;
import static com.iwhalecloud.byai.common.constants.Constants.ResourceBizType.KG_DB;
import static com.iwhalecloud.byai.common.constants.Constants.ResourceBizType.KG_DOC;
import static com.iwhalecloud.byai.common.constants.Constants.ResourceBizType.KG_QA;
import static com.iwhalecloud.byai.common.constants.Constants.ResourceBizType.KG_TERM;
import static com.iwhalecloud.byai.common.constants.Constants.ResourceBizType.MCP;
import static com.iwhalecloud.byai.common.constants.Constants.ResourceBizType.MCP_TOOL;
import static com.iwhalecloud.byai.common.constants.Constants.ResourceBizType.OBJECT;
import static com.iwhalecloud.byai.common.constants.Constants.ResourceBizType.TOOL;
import static com.iwhalecloud.byai.common.constants.Constants.ResourceBizType.VIEW;

/**
 * 数字员工运营数据分析服务
 *
 * @author zzh
 */
@Service
public class OperationsDigEmployeeService {
    private static final Logger logger = LoggerFactory.getLogger(OperationsDigEmployeeService.class);

    private static final String PAGE_ID = "1264428198659473408";

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private ByaiMessageRelObjService byaiMessageRelObjService;

    @Autowired
    private OperationsQueryService operationsQueryService;

    @Autowired
    private SsResExtEvaluateService ssResExtEvaluateService;

    @Autowired
    private SystemConfigService systemConfigService;

    @Autowired
    private FeignPythonToolService feignPythonService;

    @Autowired
    private UsersMapper usersMapper;

    @Autowired
    private SsResourceCatalogMapper ssResourceCatalogMapper;

    @Autowired
    private PrivilegeGrantMapper privilegeGrantMapper;

    @Autowired
    private EvaluationManager evaluationManager;

    @Autowired
    private SsResExtTestSetService ssResExtTestSetService;

    @Autowired
    private FilesApplicationService filesApplicationService;

    /**
     * 技能类型集合
     */
    private static final Set<String> SKILL_TYPES = Set.of(DIG_EMPLOYEE, AGENT, TOOL, MCP, MCP_TOOL, VIEW, OBJECT);

    /**
     * 知识库类型集合
     */
    private static final Set<String> KNOWLEDGE_TYPES = Set.of(KG_QA, KG_DOC, KG_DB, KG_TERM);

    /**
     * 获取数字员工运营信息 包括基本信息、技能列表和知识库列表
     *
     * @param resourceId 数字员工资源ID
     * @return 数字员工运营信息
     */
    public DigEmployeeOperationsVO getDigEmployeeOperationsInfo(Long resourceId) {
        if (resourceId == null) {
            logger.error("获取数字员工运营信息参数错误, resourceId不能为空");
            return null;
        }

        // 查询基本信息
        DigEmployeeOperationsVO result = ssResourceMapper.queryDigEmployeeBasicInfo(resourceId);
        if (result == null) {
            logger.warn("未找到数字员工ID={}的基本信息", resourceId);
            return null;
        }
        if (StringUtils.isNotEmpty(result.getManUserId())) {
            String[] split = result.getManUserId().split(",");
            List<String> list = Arrays.stream(split).toList();
            List<Users> users = usersMapper.selectBatchIds(list);
            if (!CollectionUtils.isEmpty(users)) {
                result.setUserName(users.stream().map(Users::getUserName).collect(Collectors.joining(",")));
            }
        }
        // 查询关联资源
        List<RelResourceVO> relResources = ssResourceMapper.queryDigEmployeeRelResources(resourceId);

        // 分类技能和知识库
        List<RelResourceVO> skillList = new ArrayList<>();
        List<RelResourceVO> knowledgeList = new ArrayList<>();

        if (!CollectionUtils.isEmpty(relResources)) {
            for (RelResourceVO relResource : relResources) {
                String resourceBizType = relResource.getResourceBizType();
                if (SKILL_TYPES.contains(resourceBizType)) {
                    skillList.add(relResource);
                }
                else if (KNOWLEDGE_TYPES.contains(resourceBizType)) {
                    knowledgeList.add(relResource);
                }
            }
        }
        result.setSkillList(skillList);
        result.setKnowledgeList(knowledgeList);
        logger.debug("数字员工ID={}的运营信息查询完成: 技能数量={}, 知识库数量={}", resourceId, skillList.size(), knowledgeList.size());
        result.setCapabilityMatchPercent(90.0);
        return result;
    }

    /**
     * 获取数字员工运营信息 - 使用指标 包括点赞量、点踩量、服务总次数、服务总人数、人均对话次数及其趋势
     *
     * @param request 指标请求参数
     * @return 使用指标响应
     */
    public Map<String, Object> getDigEmployeeMetrics(MessageRelObjMetricsRequest request) {
        String processedConfigJson = operationsQueryService.getMetricESConfigJson(request.getQueryCode(),
            request.getParams());
        // 本地直接调用 ES 查询指标，不再通过 Feign 调用远程服务
        Map<String, Object> data = byaiMessageRelObjService.queryMetricsByConfig(processedConfigJson);
        if (data == null) {
            throw new BaseException(I18nUtil.get("operations.digemployee.metrics.service.failed", "指标查询返回为空"));
        }
        if (DIG_EMPLOYEE_USAGE_METRICS.getCode().equalsIgnoreCase(request.getQueryCode())) {
            processUsageMetricsData(data);
        }
        else if (DIG_EMPLOYEE_TECHNICAL_METRICS.getCode().equalsIgnoreCase(request.getQueryCode())) {
            processTechnicalMetricsData(data);
        }
        else if (DIG_EMPLOYEE_ACCURACY_METRICS.getCode().equalsIgnoreCase(request.getQueryCode())) {
            processAccuracyMetricsData(data, request.getParams());
        }
        return data;
    }

    private void processUsageMetricsData(Map<String, Object> resultData) {
        Double avgConversationCount = (Double) resultData.get("avgConversationCount");
        if (avgConversationCount == null) {
            avgConversationCount = 0.0;
        }
        // 四舍五入 保留两位小数
        Double roundedAvgConversationCount = Math.round(avgConversationCount * 100.0d) / 100.0d;
        resultData.put("avgConversationCount", roundedAvgConversationCount);

        // 处理趋势数据，计算用户满意度
        processSatisfactionTrend(resultData);
    }

    /**
     * 处理用户满意度趋势
     *
     * @param resultData 结果数据
     */
    private void processSatisfactionTrend(Map<String, Object> resultData) {
        Object trendObj = resultData.get("trend");
        if (!(trendObj instanceof List<?> trendList)) {
            return;
        }
        for (Object item : trendList) {
            if (!(item instanceof Map<?, ?> itemMap)) {
                continue;
            }

            @SuppressWarnings("unchecked")
            Map<String, Object> trendItem = (Map<String, Object>) itemMap;

            // 获取serviceCount
            Double serviceCount = getDoubleValue(trendItem.get("serviceCount"));

            // 获取dayPraiseCount中的docCount
            Double dayPraiseCount = extractTreadCount(trendItem.get("dayPraiseCount"));

            // 获取dayTreadCount中的docCount
            Double dayTreadCount = extractTreadCount(trendItem.get("dayTreadCount"));

            // 计算用户满意度：(dayPraiseCount - dayTreadCount) * 100.0 / serviceCount
            double satisfactionRate = (serviceCount != null && serviceCount > 0)
                ? (dayPraiseCount - dayTreadCount) * 100.0 / serviceCount
                : 0.0;

            // 保留两位小数
            satisfactionRate = Math.round(satisfactionRate * 100.0) / 100.0;

            // 添加到趋势数据中
            trendItem.put("userSatisfactionRate", satisfactionRate);
        }
    }

    /**
     * 处理指标数据，进行额外计算
     *
     * @param resultData 指标数据
     * @param params 参数
     */
    private void processAccuracyMetricsData(Map<String, Object> resultData, Map<String, Object> params) {
        if (resultData == null) {
            return;
        }
        try {
            // 安全地获取数值类型字段
            Double totalServiceCount = getDoubleValue(resultData.get("totalServiceCount"));
            // treadCount 可能是一个对象 { "docCount": 0 }，需要从中提取数值
            Double treadCount = extractTreadCount(resultData.get("treadCount"));
            // 实际使用回复准确率
            double actualResponseAccuracy = (totalServiceCount == null || totalServiceCount == 0.0) ? 0.0
                : (totalServiceCount - treadCount) / totalServiceCount * 100.0;
            actualResponseAccuracy = Math.round(actualResponseAccuracy * 100.0d) / 100.0d;
            resultData.put("actualResponseAccuracy", actualResponseAccuracy);
            // 测试集回复准确率
            resultData.put("testResponseAccuracy", null);
            // 测试集意图识别准确率
            resultData.put("testIntentRecognitionAccuracy", null);
            resultData.put("fileId", null);
            resultData.put("processStatus", null);
            resultData.put("failReason", null);
            resultData.put("fileName", null);
            resultData.put("fileUrl", null);
            resultData.put("batchId", null);
            resultData.put("testSetId", null);
            resultData.put("resourceId", null);
        }
        catch (Exception e) {
            logger.error("处理准确率指标数据时发生异常", e);
            throw new BaseException("operations.digemployee.accuracy.metrics.process.error", e);
        }

        if (params == null) {
            throw new BaseException("operations.digemployee.param.not.null");
        }
        Object resourceIdObj = params.get("resourceId");
        if (resourceIdObj == null) {
            throw new BaseException("operations.digemployee.resource.id.not.null");
        }
        Long resourceId = Long.parseLong(resourceIdObj.toString());
        SsResExtTestSet ssResExtTestSet = ssResExtTestSetService.findLatestByResourceId(resourceId);
        if (ssResExtTestSet != null) {
            resultData.put("testResponseAccuracy", ssResExtTestSet.getTestSetAccuracy());
            resultData.put("testIntentRecognitionAccuracy", ssResExtTestSet.getTestSetIntentRecognitionAccuracy());
            resultData.put("fileId", ssResExtTestSet.getFileId());
            resultData.put("processStatus", ssResExtTestSet.getProcessStatus());
            resultData.put("failReason", ssResExtTestSet.getFailReason());
            resultData.put("fileName", ssResExtTestSet.getFileName());
            resultData.put("fileUrl", ssResExtTestSet.getFileUrl());
            resultData.put("batchId", ssResExtTestSet.getBatchId());
            resultData.put("testSetId", ssResExtTestSet.getTestSetId());
            resultData.put("resourceId", ssResExtTestSet.getResourceId());
        }
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
     * 从treadCount字段提取数值 treadCount 可能是直接的数值，也可能是包含docCount的对象
     *
     * @param treadCountValue treadCount字段的值
     * @return 提取的数值，如果提取失败返回0.0
     */
    private Double extractTreadCount(Object treadCountValue) {
        if (treadCountValue == null) {
            return 0.0;
        }

        // 如果是直接的数值类型
        if (treadCountValue instanceof Number) {
            return ((Number) treadCountValue).doubleValue();
        }

        // 如果是包含docCount的对象，如 { "docCount": 0 }
        if (treadCountValue instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> treadCountMap = (Map<String, Object>) treadCountValue;
            Object docCount = treadCountMap.get("docCount");
            return getDoubleValue(docCount);
        }

        // 尝试作为字符串转换
        return getDoubleValue(treadCountValue);
    }

    /**
     * 处理指标数据，进行额外计算
     *
     * @param resultData 指标数据
     */
    private void processTechnicalMetricsData(Map<String, Object> resultData) {
        if (resultData == null) {
            return;
        }
        try {
            // 1. 计算平均每秒token数：outputTokenTotal / outputTokenPerSecondTotal（ES 可能返回 Long/Double，用 getDoubleValue 统一转
            // double）
            double outputTokenTotal = getDoubleValue(resultData.get("outputTokenTotal"));
            double outputTokenPerSecondTotal = getDoubleValue(resultData.get("outputTokenPerSecondTotal"));
            resultData.put("avgOutPutTokenPerSecond",
                outputTokenPerSecondTotal > 0 ? outputTokenTotal / outputTokenPerSecondTotal : 0.0);

            // 2. 遍历trend，累加dayOutputTokenSecond得到每秒token总数
            Object trendObj = resultData.get("trend");
            if (trendObj instanceof List<?> trendList && !trendList.isEmpty()) {
                double totalTokenPerSecond = 0.0;
                for (Object item : trendList) {
                    if (item instanceof Map<?, ?> itemMap) {
                        double dayOutputTokenSecond = getDoubleValue(itemMap.get("dayOutputTokenSecond"));
                        totalTokenPerSecond += dayOutputTokenSecond;
                    }
                }
                resultData.put("avgOutPutTokenPerSecondTotal", totalTokenPerSecond);
            }
        }
        catch (Exception e) {
            logger.error("处理指标数据时发生异常", e);
            throw new BaseException("operations.digemployee.metrics.process.error", e);
        }
    }

    /**
     * 判断资源是否存在
     *
     * @param resourceId 资源ID
     */
    private SsResource validateResource(Long resourceId) {
        SsResource ssResource = ssResourceMapper.selectById(resourceId);
        if (ssResource == null) {
            throw new BaseException("resource.not.found");
        }
        return ssResource;
    }

    /**
     * 获取数字员工的授权对象（管理授权）
     *
     * @param resourceId 资源ID
     */
    private List<PrivilegeGrant> getAuthorizedObjects(Long resourceId) {
        validateResource(resourceId);
        LambdaQueryWrapper<PrivilegeGrant> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(PrivilegeGrant::getGrantType, GrantType.ALLOW_MANAGE);
        wrapper.eq(PrivilegeGrant::getOperType, OperType.READ);
        wrapper.eq(PrivilegeGrant::getGrantObjType, Constants.ResourceBizType.DIG_EMPLOYEE);
        wrapper.eq(PrivilegeGrant::getGrantObjId, resourceId);
        wrapper.eq(PrivilegeGrant::getStatusCd, UserState.ACTIVE);
        wrapper.eq(PrivilegeGrant::getGrantToType, Color.RED);
        return privilegeGrantMapper.selectList(wrapper);
    }

    @Autowired
    private PositionUserRelationService positionUserRelationService;

    @Autowired
    private PositionService positionService;

    @Autowired
    private PositionExtCatalogMapper positionExtCatalogMapper;

    /**
     * 获取业务领域是否存在
     *
     * @param catalogId 领域ID
     */
    private void validateResourceCatalog(Long catalogId) {
        SsResourceCatalog ssResourceCatalog = ssResourceCatalogMapper.selectById(catalogId);
        if (ssResourceCatalog == null) {
            throw new BaseException("operations.digemployee.catalog.not.found");
        }
    }

    /**
     * 判断是否为岗位是否符合该领域下
     *
     * @param positionId 岗位ID
     * @param catalogId 领域ID
     */
    private void validateCatalogPosition(Long catalogId, Long positionId) {
        LambdaQueryWrapper<PositionExtCatalog> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(PositionExtCatalog::getPositionId, positionId);
        wrapper.eq(PositionExtCatalog::getCatalogId, catalogId);
        PositionExtCatalog positionExtCatalog = positionExtCatalogMapper.selectOne(wrapper);
        if (positionExtCatalog == null) {
            throw new BaseException("operations.digemployee.position.not.found");
        }
    }

    /**
     * 获取评估详情结果
     *
     * @param resourceId 资源ID
     * @return 评分详情结果
     */
    public SsResExtEvaluateCompareVO getEvaluateDetail(Long resourceId) {
        // 创建比对对象
        SsResExtEvaluateCompareVO compareVO = new SsResExtEvaluateCompareVO(resourceId);

        // 获取评估配置映射
        Map<String, Object> evaluateConfigMap = getEvaluateConfigMap();

        // 设置基准值
        setStandardValues(compareVO.getStandardVO(), evaluateConfigMap);

        // 获取最新的评估结果
        SsResExtEvaluate ssResExtEvaluate = ssResExtEvaluateService.findLatestByResourceId(resourceId);
        // 如果评估结果为空，则返回空
        if (ssResExtEvaluate == null) {
            return compareVO;
        }
        BeanUtils.copyProperties(ssResExtEvaluate, compareVO.getEvaluateVO());
        compareVO.setIsQualifiedForPost(ssResExtEvaluate.getIsQualifiedForPost());
        compareVO.setEvaluateTime(ssResExtEvaluate.getEvaluateTime());
        return compareVO;
    }

    /**
     * 立即评估
     *
     * @param resourceId 资源ID
     * @return 立即评估结果
     */
    public SsResExtEvaluateCompareVO immediatelyEvaluate(Long resourceId) {
        // 调用评估管理器执行立即评估
        return evaluationManager.immediatelyEvaluate(resourceId);
    }

    /**
     * 获取评估配置映射
     *
     * @return 评估配置映射，key为param_code，value为param_value
     */
    private Map<String, Object> getEvaluateConfigMap() {
        List<String> evaluateTypeCodeList = List.of(TEST_SET_ACCURACY.getCode(),
            EvaluateType.ACTUAL_USE_ACCURACY.getCode(), EvaluateType.CONVERSATION_ERROR_RATE.getCode(),
            EvaluateType.AVG_FIRST_RESPONSE_DURATION.getCode(), EvaluateType.PERSONA_SPECIFICATION_SCORE.getCode(),
            EvaluateType.ABILITY_POST_MATCHING_SCORE.getCode());
        // code -> value
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
        standardVO
            .setActualUseAccuracy(parseBigDecimal((String) configMap.get(EvaluateType.ACTUAL_USE_ACCURACY.getCode())));
        standardVO.setConversationErrorRate(
            parseBigDecimal((String) configMap.get(EvaluateType.CONVERSATION_ERROR_RATE.getCode())));
        standardVO.setAvgFirstResponseDuration(
            parseBigDecimal((String) configMap.get(EvaluateType.AVG_FIRST_RESPONSE_DURATION.getCode())));
        standardVO.setPersonaSpecificationScore(
            parseBigDecimal((String) configMap.get(EvaluateType.PERSONA_SPECIFICATION_SCORE.getCode())));
        standardVO.setAbilityPostMatchingScore(
            parseBigDecimal((String) configMap.get(EvaluateType.ABILITY_POST_MATCHING_SCORE.getCode())));
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
            logger.warn("转换BigDecimal失败: {}", value, e);
            return null;
        }
    }

    /**
     * 上传测试集获取测试集结果
     *
     * @param resourceId 资源ID
     * @param file 测试集文件Excel
     * @return 测试集结果
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED, readOnly = false)
    public SsResExtTestSet uploadTestSet(Long resourceId, MultipartFile file) {
        SsResource ssResource = validateResource(resourceId);
        // 校验文件并获取文件内容
        validateTestSetFile(file);

        // 调用python获取测试集结果以及测试集准确率
        String payLoadConfig = buildPayLoadConfigJsonParams(ssResource);

        // 构建对象
        SsResExtTestSet ssResExtTestSet = new SsResExtTestSet();

        ssResExtTestSet.setResourceId(resourceId);
        ssResExtTestSet.setFileName(file.getOriginalFilename());
        ssResExtTestSet.setFileUrl(null);
        ssResExtTestSet.setFileId(null);
        ssResExtTestSet.setProcessStatus(EvaluateTestSetType.PROCESSING.getCode());
        ssResExtTestSet.setTestSetAccuracy(null);
        ssResExtTestSet.setTestSetIntentRecognitionAccuracy(null);

        // Map<String, Object> resultMap = uploadExcelAndSubmitTasks(file, payLoadConfig);
        try {
            logger.info("开始上传Excel文件并提交任务, payloadConfigJson: {}", payLoadConfig);

            // 调用Python服务上传Excel文件并提交任务
            Map<String, Object> result = feignPythonService.uploadExcelAndSubmitTasks(file, payLoadConfig);

            // 构建返回结果
            String batchId = (String) result.get("batch_id");
            ssResExtTestSet.setBatchId(batchId);
            logger.info("上传Excel文件并提交任务完成, 结果: {}", result);

        }
        catch (Exception e) {
            logger.error("上传Excel文件并提交任务失败: {}", e.getMessage());
            // 提取真实的错误信息
            String errorMessage = extractErrorMessage(e.getMessage());

            // 截取错误信息，最多500个字符
            if (errorMessage.length() > 500) {
                errorMessage = errorMessage.substring(0, 500);
            }

            // 处理失败 - 解析Python服务返回的错误信息
            ssResExtTestSet.setProcessStatus(EvaluateTestSetType.FAILED.getCode());
            ssResExtTestSet.setFailReason(errorMessage);
        }
        finally {
            ssResExtTestSetService.saveOrUpdate(ssResExtTestSet);
            logger.info("测试集记录保存成功，ID: {}, 状态: {}", ssResExtTestSet.getTestSetId(), ssResExtTestSet.getProcessStatus());
        }
        return ssResExtTestSet;
    }

    /**
     * 获取测试集的参数（用于python服务调用模型信息）
     *
     * @param ssResource 数字员工资源
     * @return 参数字符串
     */
    private String buildPayLoadConfigJsonParams(SsResource ssResource) {

        Map<String, Object> params = new HashMap<>();
        // 基本信息 - 参考ParamService的实现
        params.put("assistant_name", CurrentUserHolder.getCurrentUserName());
        params.put("assistant_intro", CurrentUserHolder.getCurrentUserName());
        params.put("assistant_id", CurrentUserHolder.getCurrentUserId());

        // 数字员工信息
        params.put("agent_id", ssResource.getResourceId());

        // 工具列表（空的，因为这是测试集评估）
        params.put("tools", new ArrayList<>());

        // 网络连接 - 默认false
        params.put("connect_net", false);

        // 用户输入（测试集评估不需要具体输入）
        params.put("user_chat_input", "测试集评估");

        // 请求时间
        params.put("request_time", System.currentTimeMillis());

        // 扩展参数
        Map<String, Object> extParams = new HashMap<>();
        extParams.put("clientId", "test_framework_" + ssResource.getResourceId());
        extParams.put("files", new ArrayList<>());
        params.put("ext_params", extParams);

        // 用户信息 - 构建基本的用户信息
        Map<String, Object> userInfo = new HashMap<>();
        userInfo.put("userId", CurrentUserHolder.getCurrentUserId());
        userInfo.put("userName", CurrentUserHolder.getCurrentUserName());
        userInfo.put("userCode", CurrentUserHolder.getCurrentUserCode());
        userInfo.put("usersOrganizations", CurrentUserHolder.getUsersOrganizations());
        userInfo.put("enterpriseId", CurrentUserHolder.getEnterpriseId());
        userInfo.put("userStation", CurrentUserHolder.getUserStation());
        userInfo.put("sessionId", CurrentUserHolder.getSessionId());
        userInfo.put("accessType", "SESSION");

        params.put("user_info", userInfo);
        // 智办模式
        params.put("smart_office", false);
        // 任务操作类型
        params.put("task_operate_type", null);

        // 加入历史聊天记录 - 测试框架没有历史消息
        params.put("app_list", new ArrayList<>());
        params.put("dataset_list", new ArrayList<>());

        // 智能体列表 - 获取当前数字员工的详细信息
        // params.put("agent_list", getDetailedAgentListForResource(ssResource.getResourceId()));

        // MCP服务器列表
        List<McpServerDto> mcpServerList = getMcpServerList();
        params.put("mcp_servers", mcpServerList);

        // 助手列表（空的）
        params.put("assistant_list", new ArrayList<>());

        // 企业信息
        params.put("use_enterprise_information", false);

        // 消息列表（测试框架不需要历史消息）
        params.put("messages", new ArrayList<>());

        // 判断是否深度思考
        params.put("deep_think", false);
        params.put("task", null);

        // 用户选择的资源
        List<Map<String, Object>> resources = new ArrayList<>();
        Map<String, Object> resource = new HashMap<>();
        resource.put("resourceId", String.valueOf(ssResource.getResourceId()));
        resource.put("resourceName", ssResource.getResourceName());
        resource.put("resourceType", Constants.ResourceBizType.DIG_EMPLOYEE);
        resources.add(resource);
        params.put("resources", resources);

        // 任务ID（空的）
        params.put("task_id", null);

        // 设置@小二的信息 - 测试框架不需要
        params.put("agent_type", null);

        // 获取场景ID列表（测试框架可能不需要）
        params.put("sceneIdList", new ArrayList<>());

        // 会话ID（测试框架不需要）
        params.put("session_id", null);

        // 消息ID（测试框架不需要）
        params.put("message_id", null);

        return JSON.toJSONString(params);
    }

    private void validateTestSetFile(MultipartFile file) {
        // 校验文件类型是否为Excel
        String originalFilename = file.getOriginalFilename();
        if (StringUtils.isEmpty(originalFilename)
            || (!originalFilename.endsWith(".xls") && !originalFilename.endsWith(".xlsx"))) {
            throw new BaseException(I18nUtil.get("operations.digemployee.upload.test.set.invalid.file"));
        }
    }

    /**
     * 构建任务指派内容显示卡片 卡片结构： - 标题：未解决问题指派任务 - 内容：xxx用户名指派了一个xxx数字员工未解决问题的任务给你，请及时处理 - 数字员工信息卡片（名称、头像、描述）- 存储在flow字段中 -
     * 按钮：查看详情、去处理
     *
     * @param request 消息反馈指派请求
     * @return 内容显示卡片
     */
    private TodoRequestDTO.ContentShowCardComplex buildTaskAssignContentShowCard(MessageFeedbackAssignRequest request,
        SsResource ssResource) {
        TodoRequestDTO.ContentShowCardComplex contentShowCard = new TodoRequestDTO.ContentShowCardComplex();

        // 设置页面标题：资源名称 + 未解决问题的指派任务
        contentShowCard.setTitle("未解决问题的指派任务");

        // 获取当前用户信息
        String currentUserName = getCurrentUserNameOrDefault();

        // 构建卡片内容
        TodoRequestDTO.CardContent cardContent = buildCardContent(currentUserName, ssResource.getResourceName(),
            request.getResourceId());
        contentShowCard.setContent(cardContent);

        // 构建按钮列表
        List<TodoRequestDTO.Button> buttons = buildTaskButtons(request.getResourceId());
        contentShowCard.setButtons(buttons);
        contentShowCard.setCardType("ASSIGN");
        contentShowCard.setResourceId(request.getResourceId());
        return contentShowCard;
    }

    /**
     * 构建卡片内容
     *
     * @param currentUserName 当前用户名
     * @param resourceName 资源名称
     * @param resourceId 资源ID
     * @return 卡片内容对象
     */
    private TodoRequestDTO.CardContent buildCardContent(String currentUserName, String resourceName, Long resourceId) {
        List<TodoRequestDTO.Block> blocks = new ArrayList<>();
        blocks.add(buildTextBlock(currentUserName, resourceName));
        blocks.add(buildAgentInfoBlock(resourceId));

        TodoRequestDTO.CardContent cardContent = new TodoRequestDTO.CardContent();
        cardContent.setBlocks(blocks);
        return cardContent;
    }

    /**
     * 构建文本内容块
     *
     * @param currentUserName 当前用户名
     * @param resourceName 资源名称
     * @return 文本块
     */
    private TodoRequestDTO.Block buildTextBlock(String currentUserName, String resourceName) {
        TodoRequestDTO.Block textBlock = new TodoRequestDTO.Block();
        textBlock.setType("text");
        textBlock.setText(currentUserName + "指派了一个" + resourceName + "未解决问题的任务给你，请及时处理");
        textBlock.setRows(1);
        return textBlock;
    }

    /**
     * 构建智能体信息块
     *
     * @param resourceId 资源ID
     * @return 智能体信息块
     */
    private TodoRequestDTO.Block buildAgentInfoBlock(Long resourceId) {
        TodoRequestDTO.Block agentBlock = new TodoRequestDTO.Block();
        agentBlock.setType("agentInfo");
        agentBlock.setAgentId(String.valueOf(resourceId));
        return agentBlock;
    }

    /**
     * 构建任务按钮列表
     *
     * @param resourceId 资源ID
     * @return 按钮列表
     */
    private List<TodoRequestDTO.Button> buildTaskButtons(Long resourceId) {
        List<TodoRequestDTO.Button> buttons = new ArrayList<>();
        buttons.add(buildHandleButton(resourceId));
        buttons.add(buildViewDetailButton(resourceId));
        return buttons;
    }

    /**
     * 构建"去处理"按钮
     *
     * @param resourceId 资源ID
     * @return 按钮对象
     */
    private TodoRequestDTO.Button buildHandleButton(Long resourceId) {
        TodoRequestDTO.Button button = new TodoRequestDTO.Button();
        button.setText("去处理");
        button.setAction(
            buildLinkAction(resourceId, "任务-去处理", "/manager/resource/employeeDetail?digitalType=FROM_MANUALLY&appId="
                + resourceId + "&readOnly=true&defaultTab=log"));
        return button;
    }

    /**
     * 构建"查看详情"按钮
     *
     * @param resourceId 资源ID
     * @return 按钮对象
     */
    private TodoRequestDTO.Button buildViewDetailButton(Long resourceId) {
        TodoRequestDTO.Button button = new TodoRequestDTO.Button();
        button.setText("查看详情");
        button.setAction(buildCustomAction(resourceId, "任务-查看详情", "todo"));
        return button;
    }

    /**
     * 构建链接类型按钮动作
     *
     * @param resourceId 资源ID
     * @param title 动作标题
     * @param url 链接URL
     * @return 按钮动作对象
     */
    private TodoRequestDTO.ButtonAction buildLinkAction(Long resourceId, String title, String url) {
        TodoRequestDTO.ButtonAction action = new TodoRequestDTO.ButtonAction();
        action.setType("link");
        action.setResourceId(resourceId);
        action.setWidth(500);
        action.setResourceBizType("DIG_EMPLOYEE");
        action.setTitle(title);
        action.setUrl(url);
        return action;
    }

    /**
     * 构建自定义类型按钮动作
     *
     * @param resourceId 资源ID
     * @param title 动作标题
     * @param url 链接URL
     * @return 按钮动作对象
     */
    private TodoRequestDTO.ButtonAction buildCustomAction(Long resourceId, String title, String url) {
        TodoRequestDTO.ButtonAction action = new TodoRequestDTO.ButtonAction();
        action.setType("custom");
        action.setResourceId(resourceId);
        action.setWidth(500);
        action.setResourceBizType("DIG_EMPLOYEE");
        action.setTitle(title);
        action.setUrl(url);
        return action;
    }

    /**
     * 获取当前用户名，默认为"系统"
     *
     * @return 用户名
     */
    private String getCurrentUserNameOrDefault() {
        String currentUserName = CurrentUserHolder.getCurrentUserName();
        return StringUtils.isBlank(currentUserName) ? "系统" : currentUserName;
    }

    /**
     * 从Feign异常信息中提取真实的错误信息
     *
     * @param errorMessage 原始错误信息
     * @return 提取后的真实错误信息
     */
    private String extractErrorMessage(String errorMessage) {
        if (StringUtils.isBlank(errorMessage)) {
            return "未知错误";
        }

        logger.debug("开始解析错误信息: {}", errorMessage);

        // 尝试从错误信息中提取JSON部分

        try {
            // 查找JSON数组的开始位置（找第一个"[{"detail"）
            int jsonStart = errorMessage.indexOf("[{\"detail\"");
            if (jsonStart >= 0) {
                // 找到detail字段值的开始位置（第一个冒号后）
                int colonIndex = errorMessage.indexOf(":\"", jsonStart);
                if (colonIndex >= 0) {
                    // 找到detail字段值的结束位置（第一个"}）
                    int endIndex = errorMessage.indexOf("\"}", colonIndex + 2);
                    if (endIndex >= 0) {
                        // 提取detail字段的值
                        String detail = errorMessage.substring(colonIndex + 2, endIndex);
                        logger.debug("提取到错误详情: {}", detail);
                        return detail;
                    }
                }
            }
        }
        catch (Exception e) {
            // 解析失败，返回原始错误信息
            logger.debug("JSON解析失败，返回原始错误信息: {}", e.getMessage());
        }

        // 如果提取或解析失败，直接返回原始错误信息
        return errorMessage;
    }

    /**
     * 获取MCP服务器列表
     *
     * @return MCP服务器列表
     */
    private List<McpServerDto> getMcpServerList() {
        // 获取用户有权限的MCP资源ID列表
        LambdaQueryWrapper<SsResource> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(SsResource::getResourceType, Constants.ResourceBizType.MCP);
        wrapper.select(SsResource::getResourceId);
        List<SsResource> ssResources = ssResourceMapper.selectList(wrapper);
        if (CollectionUtils.isEmpty(ssResources)) {
            return Lists.newArrayList();
        }
        List<Long> list = ssResources.stream().map(SsResource::getResourceId).toList();
        // 如果没有权限的MCP资源，返回空列表
        if (CollectionUtils.isEmpty(list)) {
            return Lists.newArrayList();
        }
        // 构建MCP服务器列表
        List<McpServer> mcpInfoByIdList = null;
        if (CollectionUtils.isEmpty(mcpInfoByIdList)) {
            return Lists.newArrayList();
        }
        List<McpServerDto> mcpInfoList = new ArrayList<>();
        mcpInfoByIdList.forEach(item -> {
            if (StringUtils.isNotEmpty(item.getHeader()) && !"null".equals(item.getHeader())) {
                try {
                    McpServerDto mcpServerDto = new McpServerDto();
                    BeanUtils.copyProperties(item, mcpServerDto);
                    mcpServerDto.setHeaders(JSON.parseObject(item.getHeader()));
                    mcpInfoList.add(mcpServerDto);
                }
                catch (JSONException e) {
                    logger.error("getMcpServerList error", e);
                }
            }
        });
        return mcpInfoList;
    }

    /**
     * 获取测试集对应批次的测试结果
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED, readOnly = false)
    public SsResExtTestSet getTestSetResult(OperationResourceTestSetRequest request) {
        SsResExtTestSet ssResExtTestSet = ssResExtTestSetService.findByResourceIdAndBatchId(request.getResourceId(),
            request.getBatchId());
        if (ssResExtTestSet == null) {
            return new SsResExtTestSet();
        }

        // 调用python 获取测试集结果
        try {
            // 调用Python远程服务获取批处理进度
            BatchProgressResponse batchProgress = feignPythonService.getBatchProgress(ssResExtTestSet.getBatchId());

            logger.info("batchProgress:{}", batchProgress);
            // 检查批处理是否完成
            if ((BatchStatus.DONE.getCode().equals(batchProgress.getStatus())
                || BatchStatus.MIXED.getCode().equals(batchProgress.getStatus()))
                && batchProgress.getProgress_percentage() >= 100) {
                // 如果成功，则更新测试集结果并获取测试集文件
                downloadAndUploadTestReport(ssResExtTestSet, batchProgress);
            }
            else if (BatchStatus.FAILED.getCode().equals(batchProgress.getStatus())) {
                // 批处理未完成，设置状态为处理中
                ssResExtTestSet.setProcessStatus(EvaluateTestSetType.FAILED.getCode());
            }
            else {
                ssResExtTestSet.setProcessStatus(EvaluateTestSetType.PROCESSING.getCode());
                return ssResExtTestSet;
            }
        }
        catch (Exception e) {
            logger.error("Failed to get batch progress for batchId: {}", request.getBatchId(), e);
            ssResExtTestSet.setProcessStatus(EvaluateTestSetType.FAILED.getCode());
            ssResExtTestSet.setFailReason(
                StringUtils.substring("Failed to get batch progress: " + extractErrorMessage(e.getMessage()), 0, 800));
        }
        finally {
            // 并更新对应测试集结果
            ssResExtTestSetService.saveOrUpdate(ssResExtTestSet);
        }
        return ssResExtTestSet;
    }

    /**
     * 下载并上传测试报告
     *
     * @param ssResExtTestSet 测试集结果对象
     * @param progressResponse 批处理进度对象
     */
    private void downloadAndUploadTestReport(SsResExtTestSet ssResExtTestSet, BatchProgressResponse progressResponse) {
        // 设置准确率
        double accuracy = Math.round(progressResponse.getAccuracy() * 100.0) / 100.0;
        ssResExtTestSet.setTestSetAccuracy(BigDecimal.valueOf(accuracy));
        ssResExtTestSet.setTestSetIntentRecognitionAccuracy(BigDecimal.valueOf(accuracy));
        try {
            // 调用Python远程服务获取Excel文件字节数组
            byte[] excelBytes = feignPythonService.downloadBatchReport(ssResExtTestSet.getBatchId());

            logger.debug("打印信息: 成功获取Excel文件，大小: {} bytes", excelBytes.length);

            // 将byte数组转换为MultipartFile
            MultipartFile multipartFile = new MultipartFileUtil(ssResExtTestSet.getFileName(),
                ssResExtTestSet.getFileName(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                excelBytes);

            // 上传文件
            List<String> tags = new ArrayList<>();
            tags.add("test_set_report");
            tags.add(String.valueOf(ssResExtTestSet.getResourceId()));
            MultipartFile[] files = new MultipartFile[1];
            files[0] = multipartFile;
            Map<String, Object> data = filesApplicationService.uploadFiles(files, tags,
                CurrentUserHolder.getCurrentUserId(), null, false);
            logger.info("uploadFiles result： {}", data);
            @SuppressWarnings("unchecked")
            List<UploadFilesRespDto> successFiles = (List<UploadFilesRespDto>) data.get("successFiles");
            if (CollectionUtils.isEmpty(successFiles)) {
                ssResExtTestSet.setProcessStatus(EvaluateTestSetType.FAILED.getCode()); // 设置处理状态为失败
                ssResExtTestSet.setFailReason("文件上传失败没有返回实际文件信息");
                return;
            }
            UploadFilesRespDto file = successFiles.get(0);
            Long fileId = file.getFileId();
            String fileUrl = file.getFileUrl();
            String fileName = file.getFileName();
            ssResExtTestSet.setFileUrl(fileUrl);
            ssResExtTestSet.setFileId(fileId != null ? String.valueOf(fileId) : null);
            ssResExtTestSet.setFileName(fileName);
            ssResExtTestSet.setProcessStatus(EvaluateTestSetType.SUCCESS.getCode()); // 设置处理状态为成功
        }
        catch (Exception e) {
            logger.error("Failed to download and upload test report for batchId: {}", ssResExtTestSet.getBatchId(), e);
            ssResExtTestSet.setProcessStatus(EvaluateTestSetType.FAILED.getCode()); // 设置处理状态为失败
            ssResExtTestSet.setFailReason(StringUtils.substring(
                "Failed to download and upload test report: " + extractErrorMessage(e.getMessage()), 0, 500));
        }
    }

    /**
     * 获取资源ID的所有测试集批次结果(分页)
     *
     * @param testSetQo 查询对象
     * @return PageInfo&lt;SsResExtTestSetVo&gt;
     */
    public PageInfo<SsResExtTestSetVo> getTestSetResultPage(SsResExtTestSetQo testSetQo) {
        return ssResExtTestSetService.selectTestSetByQo(testSetQo);
    }

}
