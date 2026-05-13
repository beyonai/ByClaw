package com.iwhalecloud.byai.manager.domain.operations.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.alibaba.fastjson.JSON;
import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import com.iwhalecloud.byai.manager.dto.operations.OperationsQueryRequest;
import com.iwhalecloud.byai.manager.dto.operations.QueryConfigListDTO;
import com.iwhalecloud.byai.manager.mapper.operations.QueryConfigMapper;
import com.iwhalecloud.byai.manager.entity.operations.QueryConfig;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import java.util.List;
import java.util.HashMap;
import java.util.Date;
import java.util.Map;
import java.util.Set;
import java.util.ArrayList;
import org.apache.commons.collections.MapUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 运营看板查询服务 根据query_config表中的配置动态执行SQL查询
 * 
 * @author ByAI Team
 * @date 2025-10-30
 */
@Service
public class OperationsQueryService {

    private static final Logger logger = LoggerFactory.getLogger(OperationsQueryService.class);


    @Autowired
    private QueryConfigMapper queryConfigMapper;

    private static final String QUERY_METHOD_ES = "ES";

    /**
     * 执行运营看板查询
     * 
     * @param request 查询请求
     * @return 查询结果
     */
    public Map<String, Object> executeQuery(OperationsQueryRequest request) {
        // 校验查询的配置是否存或有效
        QueryConfig queryConfig = validateAndGetQueryConfig(request);
        // 构建查询参数
        Map<String, Object> sqlParams = buildSqlParams(request, queryConfig);
        // 判断是否使用分页
        boolean usePageHelper = shouldUsePageHelper(sqlParams);

        // 提取分页参数
        PageParams pageParams = extractPageParams(request, usePageHelper, sqlParams);

        List<Map<String, Object>> resultList = executeDynamicSql(queryConfig.getSqlTemplate(), sqlParams);

        return buildQueryResult(resultList, usePageHelper, pageParams, request.getQueryCode());
    }

    /**
     * 获取指标查询编码执行的结果esJson
     */
    public String getMetricESConfigJson(String queryCode, Map<String, Object> params) {
        if (!StringUtils.hasText(queryCode)) {
            throw new BaseException("operations.query.code.not.null");
        }
        // 验证获取查询配置
        OperationsQueryRequest operationsQueryRequest = new OperationsQueryRequest();
        operationsQueryRequest.setQueryCode(queryCode);
        QueryConfig queryConfig = validateAndGetQueryConfig(operationsQueryRequest);

        if (!QUERY_METHOD_ES.equals(queryConfig.getQueryMethod())) {
            throw new BaseException("operations.query.not.es.method");
        }

        // 验证参数是否覆盖condition_fields
        Boolean isConditionCovered = isConditionCovered(queryConfig.getConditionFields(), params);
        if (!isConditionCovered) {
            throw new BaseException("operations.query.condition.not.covered");
        }

        // 构建执行ES的JSON
        String sqlTemplate = queryConfig.getSqlTemplate();
        return buildESJson(sqlTemplate, params);
    }

    /*
     * 构建查询结果
     */
    private String buildESJson(String sqlTemplate, Map<String, Object> params) {
        if (!StringUtils.hasText(sqlTemplate)) {
            throw new BaseException("operations.query.template.not.null");
        }
        String result = sqlTemplate;
        Set<Map.Entry<String, Object>> entries = params.entrySet();
        for (Map.Entry<String, Object> entry : entries) {
            String placeholder = entry.getKey();
            Object value = entry.getValue();
            String placeholderKey = "${" + placeholder + "}";
            result = result.replace(placeholderKey, value.toString());
        }
        return result;
    }

    /**
     * 验证并获取查询配置
     */
    private QueryConfig validateAndGetQueryConfig(OperationsQueryRequest request) {
        QueryConfig queryConfig = queryConfigMapper.selectByQueryCodeAndType(request.getQueryCode());
        if (queryConfig == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("operations.query.config.not.found", request.getQueryCode()));
        }
        if (queryConfig.getStatus() == null || queryConfig.getStatus() != 1) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("operations.query.config.disabled", queryConfig.getName()));
        }
        return queryConfig;
    }

    /**
     * 提取分页参数
     */
    private PageParams extractPageParams(OperationsQueryRequest request, boolean usePageHelper,
        Map<String, Object> sqlParams) {
        if (!usePageHelper) {
            return new PageParams(null, null);
        }
        Map<String, Object> params = request.getParams();
        if (params == null) {
            return new PageParams(null, null);
        }

        sqlParams.remove("page_index");
        sqlParams.remove("page_size");

        Integer pageIndex = parsePageParam(params.get("pageIndex"));
        Integer pageSize = parsePageParam(params.get("pageSize"));
        if (pageIndex != null && pageSize != null && pageSize > 0) {
            PageHelper.startPage(pageIndex, pageSize);
            logger.debug("使用PageHelper分页：pageIndex={}, pageSize={}", pageIndex, pageSize);
        }
        return new PageParams(pageIndex, pageSize);
    }

    /**
     * 解析分页参数
     */
    private Integer parsePageParam(Object paramObj) {
        if (paramObj == null) {
            return null;
        }
        if (paramObj instanceof Number) {
            return ((Number) paramObj).intValue();
        }
        if (paramObj instanceof String) {
            try {
                return Integer.parseInt((String) paramObj);
            }
            catch (NumberFormatException e) {
                logger.warn("分页参数格式错误: " + paramObj);
                return null;
            }
        }
        return null;
    }

    /**
     * 构建查询结果
     */
    private Map<String, Object> buildQueryResult(List<Map<String, Object>> resultList, boolean usePageHelper,
        PageParams pageParams, String queryCode) {
        Map<String, Object> result = new HashMap<>();
        if (usePageHelper && pageParams.isValid()) {
            PageInfo<Map<String, Object>> pageInfo = new PageInfo<>(resultList);
            result.put("list", resultList);
            result.put("total", pageInfo.getTotal());
            result.put("pageIndex", pageParams.getPageIndex());
            result.put("pageSize", pageParams.getPageSize());
            result.put("pages", pageInfo.getPages());
            logger.debug("PageHelper分页结果：total={}, pageIndex={}, pageSize={}", pageInfo.getTotal(),
                pageParams.getPageIndex(), pageParams.getPageSize());
        }
        else {
            result.put("list", resultList);
            result.put("total", (long) resultList.size());
        }
        logger.info("运营看板查询执行成功，queryCode: {}, 返回记录�? {}, 总数: {}", queryCode, resultList.size(),
            result.get("total"));
        return result;
    }

    /**
     * 判断是否使用PageHelper分页 如果condition_fields中包含pageIndex或pageSize，并且params中也有这两个参数，则使用PageHelper分页
     * 
     * @return true-使用PageHelper分页，false-不使�?
     */
    private boolean shouldUsePageHelper(Map<String, Object> sqlParams) {

        return hasPageParams(sqlParams);
    }



    /**
     * 检查参数中是否包含分页参数
     */
    private boolean hasPageParams(Map<String, Object> params) {
        if (params == null) {
            return false;
        }
        boolean hasPageIndexParam = params.containsKey("pageIndex") || params.containsKey("page_index");
        boolean hasPageSizeParam = params.containsKey("pageSize") || params.containsKey("page_size");
        return hasPageIndexParam && hasPageSizeParam;
    }

    /**
     * 构建SQL参数Map 根据condition_fields从请求参数中提取对应的参�?如果使用PageHelper分页，则排除pageIndex和pageSize参数
     *
     * @param request 查询请求
     * @param queryConfig 查询配置
     * @return SQL参数Map
     */
    private Map<String, Object> buildSqlParams(OperationsQueryRequest request, QueryConfig queryConfig) {
        Map<String, Object> params = new HashMap<>();

        // 如果使用PageHelper分页，则排除pageIndex和pageSize
        Map<String, Object> conditionParams = extractConditionParams(request, queryConfig.getConditionFields());
        if (MapUtils.isNotEmpty(conditionParams)) {
            params.putAll(conditionParams);
        }

        return params;
    }

    /**
     * 根据condition_fields从请求参数中提取对应的参�?支持从params Map中提取，也支持下划线和驼峰格式转�?如果使用PageHelper分页，则排除pageIndex和pageSize参数
     * 
     * @param request 查询请求
     * @param conditionFieldsJson condition_fields JSON字符串，如：["org_id", "agent_id"] �?["orgId", "agentId"]
     * @return 提取的条件参数Map
     */
    private Map<String, Object> extractConditionParams(OperationsQueryRequest request, String conditionFieldsJson) {
        Map<String, Object> conditionParams = new HashMap<>();

        // 如果没有定义condition_fields，返回空Map
        if (!StringUtils.hasText(conditionFieldsJson)) {
            return conditionParams;
        }

        // 验证参数是否覆盖condition_fields
        Boolean isConditionCovered = isConditionCovered(conditionFieldsJson, request.getParams());
        if (!isConditionCovered) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("operations.query.params.not.covered"));
        }

        // 创建新的Map，避免在遍历时修改原Map导致ConcurrentModificationException
        Map<String, Object> requestParams = request.getParams();

        Map<String, Object> sqlParam = new HashMap<>();
        for (Map.Entry<String, Object> entry : requestParams.entrySet()) {
            String key = entry.getKey();

            // 将驼峰格式转换为下划线格式
            String newKey = toUnderScoreCase(key);
            sqlParam.put(newKey, entry.getValue());
        }

        return sqlParam;
    }

    /**
     * @param conditionFieldsJson 数据库的condition_fields
     * @param params 请求参数
     * @return 判断是否匹配防止传递的参数不正确非法注入攻击
     */
    private Boolean isConditionCovered(String conditionFieldsJson, Map<String, Object> params) {
        // 如果params为空，返回false
        if (!StringUtils.hasText(conditionFieldsJson)) {
            return true;
        }
        if (MapUtils.isEmpty(params)) {
            return false;
        }
        String[] conditionFields = conditionFieldsJson.split(",");
        for (String field : conditionFields) {
            String trimmedField = field.trim();
            String fieldValue = toCamelCase(trimmedField);
            if (!params.containsKey(fieldValue)) {
                return false;
            }
        }
        return true;
    }

    /**
     * 下划线命名转驼峰命名（如：start_time �?startTime，period_type �?periodType�?
     * 
     * @param underScoreField 下划线分隔的字段�?
     * @return 驼峰格式字段�?
     */
    private String toCamelCase(String underScoreField) {
        if (!StringUtils.hasText(underScoreField)) {
            return underScoreField;
        }
        // 按下划线拆分
        String[] parts = underScoreField.split("_");
        StringBuilder camelCase = new StringBuilder(parts[0]); // 第一个单词小�?
        // 从第二个单词开始，首字母大写，拼接后续部分
        for (int i = 1; i < parts.length; i++) {
            if (StringUtils.hasText(parts[i])) {
                camelCase.append(StringUtils.capitalize(parts[i].toLowerCase()));
            }
        }
        return camelCase.toString();
    }

    /**
     * 驼峰命名转下划线命名（如：startTime �?start_time，periodType �?period_type�?
     * 
     * @param camelCaseField 驼峰格式字段名（小驼�?大驼峰均支持�?
     * @return 下划线分隔的字段名（全小写，符合数据库字段命名规范）
     */
    private String toUnderScoreCase(String camelCaseField) {
        if (!StringUtils.hasText(camelCaseField)) {
            return camelCaseField;
        }
        StringBuilder underScore = new StringBuilder();
        // 遍历每个字符，在大写字母前插入下划线，再转为小写
        for (int i = 0; i < camelCaseField.length(); i++) {
            char c = camelCaseField.charAt(i);
            if (Character.isUpperCase(c)) {
                // 大写字母前加下划线（避免字段开头出现下划线�?
                if (underScore.length() > 0) {
                    underScore.append("_");
                }
                // 大写转小�?
                underScore.append(Character.toLowerCase(c));
            }
            else {
                // 小写字母/数字直接拼接
                underScore.append(c);
            }
        }
        return underScore.toString();
    }

    /**
     * 格式化时间戳为SQL兼容格式 支持PostgreSQL的TIMESTAMP格式�?YYYY-MM-DD HH24:MI:SS'
     * 
     * @param date 日期对象
     * @return 格式化后的时间字符串
     */
    private String formatTimestampForSql(Date date) {
        if (date == null) {
            return null;
        }
        // 使用SimpleDateFormat格式化，兼容PostgreSQL TIMESTAMP格式
        java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
        return sdf.format(date);
    }

    /**
     * 执行动态SQL 使用MyBatis的SqlSession直接执行SQL语句
     * 
     * @param sqlTemplate SQL模板，支�?{paramName}占位符替�?
     * @param params 参数Map
     * @return 查询结果列表
     */
    private List<Map<String, Object>> executeDynamicSql(String sqlTemplate, Map<String, Object> params) {
        logger.debug("执行动态SQL模板: {}", sqlTemplate);
        logger.debug("SQL参数: {}", JSON.toJSONString(params));

        String processedSql = null;
        try {
            // 先替换SQL模板中的${}占位符
            processedSql = replaceSqlPlaceholders(sqlTemplate, params);
            logger.debug("处理后的SQL: {}", processedSql);

            // 使用Mapper执行动态SQL
            // 将处理后的SQL作为模板传递给Mapper
            List<Map<String, Object>> result = queryConfigMapper.executeDynamicSql(processedSql);

            return result != null ? result : new ArrayList<>();
        }
        catch (BadSqlGrammarException sqlEx) {
            logger.error("SQL语法错误，SQL: {}", sqlEx.getSql(), sqlEx);
            if (sqlEx.getSQLException() != null) {
                logger.error("SQL异常状态码: {}, 错误�? {}", sqlEx.getSQLException().getSQLState(),
                    sqlEx.getSQLException().getErrorCode());
            }
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("operations.query.execute.failed", sqlEx.getMessage()), sqlEx);

        }
        catch (Exception e) {
            // 记录完整的错误信息，包括SQL和参�?
            String errorMsg = e.getMessage();
            if (e.getCause() != null) {
                errorMsg = e.getCause().getMessage();
            }
            logger.error("执行动态SQL失败，SQL模板: {}", sqlTemplate, e);
            logger.error("处理后的SQL: {}", processedSql != null ? processedSql : "null");
            logger.error("SQL参数: {}", JSON.toJSONString(params));
            logger.error("错误信息: {}", errorMsg);

            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get(
                "operations.query.execute.failed", errorMsg != null ? errorMsg : e.getClass().getSimpleName()), e);
        }
    }

    /**
     * 替换SQL模板中的${}占位�?思路�?1. 先修复SQL模板中可能的语法问题（如CASE语句�?2. 找出SQL模板中所有的${xxx}占位�?3. 对每个占位符，从params中查找对应的�?4. 如果找不到值，抛出异常
     * 5. 格式化参数值并替换所有占位符
     * 
     * @param sqlTemplate SQL模板
     * @param params 参数Map
     * @return 替换后的SQL
     */
    private String replaceSqlPlaceholders(String sqlTemplate, Map<String, Object> params) {
        if (!StringUtils.hasText(sqlTemplate)) {
            return sqlTemplate;
        }

        // 如果sql没有参数，直接返回sql
        if (params == null) {
            return sqlTemplate;
        }

        String result = sqlTemplate;

        // 第一步：修复SQL模板中可能的语法问题
        // 例如：CASE ${period_type} WHEN ... 应该改为 CASE WHEN '${period_type}' = ... THEN ...
        result = fixCaseStatementSyntax(result);

        // 第二步：找出SQL模板中所有的${xxx}占位�?
        // 使用正则表达式匹�?${参数名}
        java.util.regex.Pattern placeholderPattern = java.util.regex.Pattern.compile("\\$\\{([^}]+)\\}");
        java.util.regex.Matcher matcher = placeholderPattern.matcher(result);

        // 存储需要替换的占位符和对应的�?
        Map<String, String> replacements = new HashMap<>();

        // 记录找不到的参数
        List<String> missingParams = new ArrayList<>();

        while (matcher.find()) {
            String placeholder = matcher.group(0); // 完整的占位符，如 ${startDate}
            String paramName = matcher.group(1); // 参数名，�?startDate

            // 从params中查找对应的�?
            if (!params.containsKey(paramName)) {
                // 如果找不到参数值，记录到缺失列表中
                missingParams.add(paramName);
                continue;
            }

            Object paramValue = params.get(paramName);

            // 格式化参数值并存储
            String replacement = formatParamValueForSql(paramValue);
            replacements.put(placeholder, replacement);
        }

        // 第三步：如果有缺失的参数，抛出异�?
        if (!missingParams.isEmpty()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("operations.query.param.missing", String.join(", ", missingParams)));
        }

        // 第四步：替换所有占位符
        // 注意：这里使用replace而不是replaceAll，因为我们已经获取了所有需要替换的内容
        for (Map.Entry<String, String> replacement : replacements.entrySet()) {
            result = result.replace(replacement.getKey(), replacement.getValue());
        }

        return result;
    }

    /**
     * 修复SQL模板中的CASE语句语法 �?CASE ${period_type} WHEN 'day' THEN ... WHEN 'week' THEN ... WHEN 'month' THEN ... END 转换�?
     * CASE WHEN ${period_type} = 'day' THEN ... WHEN ${period_type} = 'week' THEN ... WHEN ${period_type} = 'month'
     * THEN ... END 注意：这里不添加引号，让后续的formatParamValueForSql来处理引�?
     * 
     * @param sql SQL模板
     * @return 修复后的SQL
     */
    private String fixCaseStatementSyntax(String sql) {
        if (!StringUtils.hasText(sql)) {
            return sql;
        }

        String result = sql;

        // 使用简单的字符串替换，避免正则表达式的转义问题
        // 先临时替�?{period_type}为占位符，避免在正则替换中被误认为命名捕获组
        String placeholder = "__PERIOD_TYPE_PLACEHOLDER__";
        result = result.replace("${period_type}", placeholder);

        // 匹配整个CASE语句块：CASE __PERIOD_TYPE_PLACEHOLDER__ WHEN ... WHEN ... WHEN ... END
        // 使用非贪婪匹配，匹配到最近的END
        java.util.regex.Pattern casePattern = java.util.regex.Pattern.compile(
            "(?i)CASE\\s+" + java.util.regex.Pattern.quote(placeholder) + "\\s+(.*?)\\s+END",
            java.util.regex.Pattern.DOTALL);

        java.util.regex.Matcher caseMatcher = casePattern.matcher(result);
        StringBuffer sb = new StringBuffer();

        while (caseMatcher.find()) {
            // 获取CASE语句的内容（不包含CASE和END�?
            // 内容应该是：WHEN 'day' THEN ... WHEN 'week' THEN ... WHEN 'month' THEN ...
            String caseContent = caseMatcher.group(1);

            // 修复WHEN条件：将 WHEN 'value' THEN 转换�?WHEN __PERIOD_TYPE_PLACEHOLDER__ = 'value' THEN
            // 注意：caseContent已经�?WHEN 'day' THEN ... 的格式，我们只需要在 WHEN 后面添加占位符和等号
            String fixedContent = caseContent.replaceAll("(?i)(WHEN)\\s+('.*?')\\s+(THEN)",
                "$1 " + placeholder + " = $2 $3");

            // 构建修复后的CASE语句：CASE ... END
            // 注意：fixedContent已经�?WHEN ... 的格式（包含WHEN），所以我们只需要在前面加上 CASE
            String replacement = "CASE " + fixedContent + " END";

            // 转义替换字符串中的特殊字符（$需要转义）
            caseMatcher.appendReplacement(sb, java.util.regex.Matcher.quoteReplacement(replacement));
        }
        caseMatcher.appendTail(sb);
        result = sb.toString();

        // 将占位符替换�?{period_type}
        result = result.replace(placeholder, "${period_type}");

        return result;
    }

    /**
     * 格式化参数值为SQL兼容格式
     * 
     * @param value 参数�?
     * @return 格式化后的字符串
     */
    private String formatParamValueForSql(Object value) {
        if (value == null) {
            return "NULL";
        }

        // 字符串类型：加单引号并转�?
        if (value instanceof String) {
            String str = (String) value;
            // 转义单引号：' -> ''
            str = str.replace("'", "''");
            return "'" + str + "'";
        }

        // 数字类型：直接返�?
        if (value instanceof Number) {
            return value.toString();
        }

        // 布尔类型：转换为true/false
        if (value instanceof Boolean) {
            return value.toString();
        }

        // 日期类型：格式化为TIMESTAMP格式
        if (value instanceof Date) {
            return "'" + formatTimestampForSql((Date) value) + "'";
        }

        // 其他类型：转换为字符串并加引�?
        String str = value.toString();
        str = str.replace("'", "''");
        return "'" + str + "'";
    }

    /**
     * 查询所有启用的查询配置列表（不包含SQL模板�?
     * 
     * @return 查询配置列表
     */
    public List<QueryConfigListDTO> getAllConfigList() {
        try {
            List<QueryConfigListDTO> configList = queryConfigMapper.selectAllConfigList();
            logger.info("查询所有启用的查询配置列表成功，返回记录数: {}", configList != null ? configList.size() : 0);
            return configList != null ? configList : new ArrayList<>();
        }
        catch (Exception e) {
            logger.error("查询所有启用的查询配置列表失败", e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("operations.query.config.list.failed", e.getMessage()), e);
        }
    }

    /**
     * 分页参数封装
     */
    private static class PageParams {
        private final Integer pageIndex;

        private final Integer pageSize;

        PageParams(Integer pageIndex, Integer pageSize) {
            this.pageIndex = pageIndex;
            this.pageSize = pageSize;
        }

        Integer getPageIndex() {
            return pageIndex;
        }

        Integer getPageSize() {
            return pageSize;
        }

        boolean isValid() {
            return pageIndex != null && pageSize != null && pageSize > 0;
        }
    }
}
