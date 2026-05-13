package com.iwhalecloud.byai.manager.domain.resource.util;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.dto.resource.DatasetExecuteRequest;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtAttribute;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDbDataset;
import com.iwhalecloud.byai.common.exception.ByAiArgumentException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import org.apache.commons.collections.CollectionUtils;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
/**
 * 数据集SQL构建工具类
 * 根据tableJoinInfo生成SELECT SQL语句
 * @author zzh
 */
public final class DatasetSqlBuilder {

    private static final Logger logger = LoggerFactory.getLogger(DatasetSqlBuilder.class);


    /**
     * 私有构造函数，防止实例化工具类
     */
    private DatasetSqlBuilder() {
        throw new IllegalStateException(I18nUtil.get("utility.class.instantiation.forbidden"));
    }

    /**
     * 根据tableJoinInfo生成SQL语句
     *
     * @param tableJoinInfo tableJoinInfo对象（Map类型）
     * @return 生成的SQL语句
     */
    public static String buildSql(Object tableJoinInfo, SsResExtDbDataset dataset, Long dataSourceId) {
        if (tableJoinInfo == null) {
            throw new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.table.join.info.not.empty"));
        }

        try {
            // 转换为Map类型
            Map<String, Object> joinInfoMap = convertToMap(tableJoinInfo);

            // 获取主表
            String mainTable = (String) joinInfoMap.get("mainTable");
            if (StringUtil.isEmpty(mainTable)) {
                throw new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.main.table.not.empty"));
            }

            // 从tableList中找到主表对应的数据源ID
            if (dataSourceId != null) {
                dataset.setMainDataSourceId(dataSourceId);
            }
            else {
                String mainDataSourceIdStr = findMainTableDataSourceId(joinInfoMap, mainTable);
                try {
                    Long mainDataSourceId = Long.parseLong(mainDataSourceIdStr);
                    dataset.setMainDataSourceId(mainDataSourceId);
                }
                catch (NumberFormatException e) {
                    ByAiArgumentException exception = new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.main.table.data.source.id.invalid", mainDataSourceIdStr));
                    exception.initCause(e);
                    throw exception;
                }
            }

            // 构建SELECT字段列表
            String selectClause = buildSelectClause(joinInfoMap);

            // 构建FROM子句
            String fromClause = "FROM " + mainTable;

            // 构建JOIN子句
            String joinClause = buildJoinClause(joinInfoMap);

            // 拼接完整SQL
            return selectClause + " " + fromClause + " " + joinClause;
        }
        catch (ByAiArgumentException e) {
            throw e;
        }
        catch (Exception e) {
            ByAiArgumentException exception = new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.generate.sql.failed", e.getMessage()));
            exception.initCause(e);
            throw exception;
        }
    }

    /**
     * 从tableList中找到主表对应的数据源ID
     *
     * @param joinInfoMap tableJoinInfo的Map对象
     * @param mainTable 主表名
     * @return 主表对应的数据源ID
     */
    @SuppressWarnings("unchecked")
    private static String findMainTableDataSourceId(Map<String, Object> joinInfoMap, String mainTable) {
        // 获取tableList
        List<Map<String, Object>> tableList = (List<Map<String, Object>>) joinInfoMap.get("tableList");
        if (CollectionUtils.isEmpty(tableList)) {
            throw new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.table.list.not.empty"));
        }

        // 遍历tableList，找到tableCode等于mainTable的项
        for (Map<String, Object> table : tableList) {
            String tableCode = (String) table.get("tableCode");
            if (mainTable.equals(tableCode)) {
                String datasourceId = (String) table.get("datasourceId");
                if (StringUtil.isNotEmpty(datasourceId)) {
                    return datasourceId;
                }
                break;
            }
        }

        throw new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.main.table.data.source.not.found", mainTable));
    }

    /**
     * 将tableJoinInfo转换为Map类型
     *
     * @param tableJoinInfo tableJoinInfo对象
     * @return Map对象
     */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> convertToMap(Object tableJoinInfo) {
        if (tableJoinInfo == null) {
            return null;
        }

        if (tableJoinInfo instanceof Map) {
            return (Map<String, Object>) tableJoinInfo;
        }

        if (tableJoinInfo instanceof String) {
            return JSON.parseObject((String) tableJoinInfo, Map.class);
        }

        // 其他类型，尝试JSON转换
        String jsonStr = JSON.toJSONString(tableJoinInfo);
        return JSON.parseObject(jsonStr, Map.class);
    }

    /**
     * 构建SELECT子句
     *
     * @param joinInfoMap tableJoinInfo的Map对象
     * @return SELECT子句
     */
    @SuppressWarnings("unchecked")
    private static String buildSelectClause(Map<String, Object> joinInfoMap) {
        // 获取tableFieldInfoList
        List<Map<String, Object>> tableFieldInfoList = (List<Map<String, Object>>) joinInfoMap.get("tableFieldInfoList");
        if (CollectionUtils.isEmpty(tableFieldInfoList)) {
            throw new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.table.field.info.list.not.empty"));
        }

        // 校验字段名称唯一性
        validateFieldNameUniqueness(tableFieldInfoList);

        // 构建SELECT字段列表
        List<String> selectFields = new ArrayList<>();

        // 遍历每个表的字段信息
        for (Map<String, Object> tableFieldInfo : tableFieldInfoList) {
            // 获取selectFieldList
            List<Map<String, Object>> selectFieldList = (List<Map<String, Object>>) tableFieldInfo.get("selectFieldList");
            if (CollectionUtils.isEmpty(selectFieldList)) {
                continue;
            }

            // 获取tableCode（作为sourceTableCode的默认值）
            String tableCode = (String) tableFieldInfo.get("tableCode");

            // 遍历每个字段
            for (Map<String, Object> field : selectFieldList) {
                String fieldCode = (String) field.get("fieldCode");
                String alias = (String) field.get("alias");

                // 如果字段中有sourceTableCode，优先使用；否则使用tableCode
                String sourceTableCode = (String) field.get("sourceTableCode");
                if (StringUtil.isEmpty(sourceTableCode)) {
                    sourceTableCode = tableCode;
                }

                // 构建字段表达式：sourceTableCode.fieldCode
                if (StringUtil.isNotEmpty(fieldCode) && StringUtil.isNotEmpty(sourceTableCode)) {
                    // 使用StringBuilder构建字段表达式，避免在循环中使用字符串拼接
                    StringBuilder fieldExprBuilder = new StringBuilder(sourceTableCode);
                    fieldExprBuilder.append(".").append(fieldCode);

                    // 如果有别名，添加AS子句
                    if (StringUtil.isNotEmpty(alias)) {
                        // 使用单引号包围别名，如果别名包含单引号则进行转义
                        String safeAlias = alias.replace("'", "''"); // SQL标准：单引号转义为两个单引号
                        fieldExprBuilder.append(" AS \"").append(safeAlias).append("\"");
                    }

                    selectFields.add(fieldExprBuilder.toString());
                }
            }
        }

        if (selectFields.isEmpty()) {
            throw new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.select.fields.list.not.empty"));
        }

        return "SELECT " + String.join(" , ", selectFields);
    }

    /**
     * 校验字段名称唯一性
     * 规则：字段最终名称（alias优先，没有alias则使用fieldCode）必须唯一
     * 如果发现重复，抛出异常提示用户修改配置
     *
     * @param tableFieldInfoList 表字段信息列表
     */
    @SuppressWarnings("unchecked")
    private static void validateFieldNameUniqueness(List<Map<String, Object>> tableFieldInfoList) {
        Set<String> usedNames = new HashSet<>();
        Map<String, String> fieldLocations = new HashMap<>(); // 用于记录重复字段的位置信息

        for (Map<String, Object> tableFieldInfo : tableFieldInfoList) {
            String tableCode = (String) tableFieldInfo.get("tableCode");
            List<Map<String, Object>> selectFieldList = (List<Map<String, Object>>) tableFieldInfo.get("selectFieldList");

            if (CollectionUtils.isEmpty(selectFieldList)) {
                continue;
            }

            for (Map<String, Object> field : selectFieldList) {
                String fieldCode = (String) field.get("fieldCode");
                String alias = (String) field.get("alias");

                if (StringUtil.isEmpty(fieldCode)) {
                    continue;
                }

                // 确定最终字段名称：alias优先，没有alias则使用fieldCode
                String finalFieldName = StringUtil.isNotEmpty(alias) ? alias : fieldCode;

                // 校验字段名称是否包含危险字符
                validateFieldNameForDangerousChars(finalFieldName);

                // 检查是否重复
                if (usedNames.contains(finalFieldName)) {
                    String existingLocation = fieldLocations.get(finalFieldName);
                    throw new ByAiArgumentException(
                            String.format("字段名称重复：'%s'。该名称已被使用在：%s。现尝试在表 '%s' 中再次使用（字段：'%s'%s）。请修改别名或字段名以确保唯一性。",
                                    finalFieldName,
                                    existingLocation,
                                    tableCode,
                                    fieldCode,
                                    StringUtil.isNotEmpty(alias) ? ", 别名：'" + alias + "'" : "")
                    );
                }

                // 记录使用情况
                usedNames.add(finalFieldName);
                String location = String.format("表 '%s' 的字段 '%s'%s",
                        tableCode,
                        fieldCode,
                        StringUtil.isNotEmpty(alias) ? " (别名：'" + alias + "')" : "");
                fieldLocations.put(finalFieldName, location);
            }
        }
    }

    /**
     * 校验字段名称是否包含危险字符
     * 危险字符包括：单引号(')、双引号(")、右单引号(')、反引号(`)、分号(;)
     * 这些字符会影响SQL语句的构建和执行
     *
     * @param fieldName 字段名称

     */
    private static void validateFieldNameForDangerousChars(String fieldName) {
        if (StringUtil.isEmpty(fieldName)) {
            return;
        }

        // 定义危险字符集合
        String dangerousChars = "'\"'`;";
        String dangerousCharsDesc = "单引号(')、双引号(\")、右单引号(')、反引号(`)、分号(;)";

        // 检查是否包含危险字符
        for (char ch : fieldName.toCharArray()) {
            if (dangerousChars.indexOf(ch) != -1) {
                throw new ByAiArgumentException(
                        String.format("字段编码或别名包含不允许的字符：%s ，请修改别名或字段名避免使用这些字符。", dangerousCharsDesc)
                );
            }
        }
    }

    /**
     * 构建JOIN子句
     *
     * @param joinInfoMap tableJoinInfo的Map对象
     * @return JOIN子句
     */
    @SuppressWarnings("unchecked")
    private static String buildJoinClause(Map<String, Object> joinInfoMap) {
        List<String> joinClauses = new ArrayList<>();

        // 处理dimensionJoinList
        List<Map<String, Object>> dimensionJoinList = (List<Map<String, Object>>) joinInfoMap.get("dimensionJoinList");
        if (!CollectionUtils.isEmpty(dimensionJoinList)) {
            for (Map<String, Object> dimensionJoin : dimensionJoinList) {
                String joinClause = buildSingleJoinClause(dimensionJoin);
                if (StringUtil.isNotEmpty(joinClause)) {
                    joinClauses.add(joinClause);
                }
            }
        }

        // 处理subJoinList
        List<Map<String, Object>> subJoinList = (List<Map<String, Object>>) joinInfoMap.get("subJoinList");
        if (!CollectionUtils.isEmpty(subJoinList)) {
            for (Map<String, Object> subJoin : subJoinList) {
                String joinClause = buildSingleJoinClause(subJoin);
                if (StringUtil.isNotEmpty(joinClause)) {
                    joinClauses.add(joinClause);
                }
            }
        }

        return String.join(" ", joinClauses);
    }


    /**
     * 从 tableJoinInfo 中提取所有表编码（tableCode）
     *
     * @param tableJoinInfo tableJoinInfo Map 对象
     * @return 表编码集合
     */
    @SuppressWarnings("unchecked")
    public static Set<String> extractTableCodes(Map<String, Object> tableJoinInfo) {
        Set<String> tableCodes = new HashSet<>();

        if (tableJoinInfo == null) {
            return tableCodes;
        }

        // 从 tableList 中提取 tableCode
        List<Map<String, Object>> tableList = (List<Map<String, Object>>) tableJoinInfo.get("tableList");
        if (!CollectionUtils.isEmpty(tableList)) {
            for (Map<String, Object> table : tableList) {
                String tableCode = (String) table.get("tableCode");
                if (StringUtil.isNotEmpty(tableCode)) {
                    tableCodes.add(tableCode);
                }
            }
        }

        // 从 tableFieldInfoList 中提取 tableCode（作为补充）
        List<Map<String, Object>> tableFieldInfoList = (List<Map<String, Object>>) tableJoinInfo.get("tableFieldInfoList");
        if (!CollectionUtils.isEmpty(tableFieldInfoList)) {
            for (Map<String, Object> tableFieldInfo : tableFieldInfoList) {
                String tableCode = (String) tableFieldInfo.get("tableCode");
                if (StringUtil.isNotEmpty(tableCode)) {
                    tableCodes.add(tableCode);
                }
            }
        }

        return tableCodes;
    }

    /**
     * 构建单个JOIN子句
     *
     * @param joinInfo 单个JOIN信息
     * @return JOIN子句
     */
    @SuppressWarnings("unchecked")
    private static String buildSingleJoinClause(Map<String, Object> joinInfo) {
        // 获取joinProperty列表
        List<Map<String, Object>> joinPropertyList = (List<Map<String, Object>>) joinInfo.get("joinProperty");
        if (CollectionUtils.isEmpty(joinPropertyList)) {
            return "";
        }

        // 获取第一个joinProperty（通常只有一个）
        Map<String, Object> joinProperty = joinPropertyList.get(0);

        // 提取JOIN类型
        String joinType = extractJoinType(joinProperty, joinInfo);
        if (StringUtil.isEmpty(joinType)) {
            return "";
        }

        // 构建表表达式
        String tableExpression = buildTableExpression(joinInfo);
        if (StringUtil.isEmpty(tableExpression)) {
            return "";
        }

        // 构建ON条件
        List<String> onConditions = buildOnConditions(joinProperty, joinInfo);
        if (onConditions.isEmpty()) {
            return "";
        }

        // 组装完整的JOIN子句
        return assembleJoinClause(joinType, tableExpression, onConditions);
    }

    /**
     * 提取JOIN类型
     */
    private static String extractJoinType(Map<String, Object> joinProperty, Map<String, Object> joinInfo) {
        String joinType = (String) joinProperty.get("joinType");
        if (StringUtil.isEmpty(joinType)) {
            joinType = (String) joinInfo.get("relType");
        }
        if (StringUtil.isEmpty(joinType)) {
            joinType = "LEFT JOIN";
        }
        return joinType.toUpperCase();
    }

    /**
     * 构建表表达式（包含别名）
     */
    private static String buildTableExpression(Map<String, Object> joinInfo) {
        String rightTableCode = (String) joinInfo.get("rightTableCode");
        String rightTableName = (String) joinInfo.get("rightTableName");

        if (StringUtil.isEmpty(rightTableCode)) {
            logger.warn("JOIN信息中缺少rightTableCode，跳过该JOIN");
            return "";
        }

        if (StringUtil.isNotEmpty(rightTableName) && !rightTableName.equals(rightTableCode)) {
            return rightTableCode + " AS " + rightTableName;
        }
        return rightTableCode;
    }

    /**
     * 构建ON条件列表
     */
    @SuppressWarnings("unchecked")
    private static List<String> buildOnConditions(Map<String, Object> joinProperty, Map<String, Object> joinInfo) {
        List<Map<String, Object>> relationList = (List<Map<String, Object>>) joinProperty.get("relationList");
        if (CollectionUtils.isEmpty(relationList)) {
            logger.warn("JOIN信息中缺少relationList，跳过该JOIN");
            return Collections.emptyList();
        }

        String leftTableName = (String) joinInfo.get("leftTableName");
        List<String> onConditions = new ArrayList<>();
        for (Map<String, Object> relation : relationList) {
            String condition = buildJoinCondition(relation, leftTableName,
                    (String) joinInfo.get("rightTableName"));
            if (StringUtil.isNotEmpty(condition)) {
                onConditions.add(condition);
            }
        }

        if (onConditions.isEmpty()) {
            logger.warn("JOIN条件列表为空，跳过该JOIN");
        }

        return onConditions;
    }

    /**
     * 组装完整的JOIN子句
     */
    private static String assembleJoinClause(String joinType, String tableExpression, List<String> onConditions) {
        return joinType + " " + tableExpression + " ON " + String.join(" AND ", onConditions);
    }

    /**
     * 构建单个JOIN条件表达式
     * 支持以下场景：
     * 1. 表字段 = 表字段：leftConditionCode + rightConditionCode
     * 2. 常量值 = 表字段：leftConditionValue + rightConditionCode
     * 3. 表字段 = 常量值：leftConditionCode + rightConditionValue
     * 4. 常量值 = 常量值：leftConditionValue + rightConditionValue
     *
     * @param relation 关联条件
     * @param leftTableName 左侧表别名（从joinInfo中获取）
     * @param rightTableName 右侧表别名（从joinInfo中获取）
     * @return 条件表达式
     */
    private static String buildJoinCondition(Map<String, Object> relation, String leftTableName, String rightTableName) {
        String conditionType = (String) relation.get("conditionType");
        if (StringUtil.isEmpty(conditionType)) {
            conditionType = "=";
        }

        // 获取左侧条件（可能是表字段或常量值）
        String leftJoinTableCode = (String) relation.get("leftJoinTableCode"); // 实际表名
        String leftConditionCode = (String) relation.get("leftConditionCode");
        String leftConditionValue = (String) relation.get("leftConditionValue");

        // 获取右侧条件（可能是表字段或常量值）
        String rightJoinTableCode = (String) relation.get("rightJoinTableCode"); // 实际表名
        String rightConditionCode = (String) relation.get("rightConditionCode");
        String rightConditionValue = (String) relation.get("rightConditionValue");

        // 构建左侧表达式（优先使用别名，如果没有别名则使用表名）
        String leftTableAlias = StringUtil.isNotEmpty(leftTableName) ? leftTableName : leftJoinTableCode;
        String leftExpr = buildConditionExpression(leftTableAlias, leftConditionCode, leftConditionValue);
        if (StringUtil.isEmpty(leftExpr)) {
            logger.warn("JOIN条件左侧表达式为空，跳过该条件");
            return "";
        }

        // 构建右侧表达式（优先使用别名，如果没有别名则使用表名）
        String rightTableAlias = StringUtil.isNotEmpty(rightTableName) ? rightTableName : rightJoinTableCode;
        String rightExpr = buildConditionExpression(rightTableAlias, rightConditionCode, rightConditionValue);
        if (StringUtil.isEmpty(rightExpr)) {
            logger.warn("JOIN条件右侧表达式为空，跳过该条件");
            return "";
        }

        // 拼接条件表达式
        return leftExpr + " " + conditionType + " " + rightExpr;
    }

    /**
     * 构建条件表达式（左侧或右侧）
     *
     * @param tableCode 表编码（如果使用表字段）
     * @param conditionCode 字段编码（如果使用表字段）
     * @param conditionValue 常量值（如果使用常量值）
     * @return 条件表达式
     */
    private static String buildConditionExpression(String tableCode, String conditionCode, String conditionValue) {
        // 优先使用常量值
        if (StringUtil.isNotEmpty(conditionValue)) {
            // 如果是数字，直接返回；如果是字符串，需要加引号
            if (isNumeric(conditionValue)) {
                return conditionValue;
            }
            else {
                return "'" + conditionValue + "'";
            }
        }

        // 使用表字段
        if (StringUtil.isNotEmpty(tableCode) && StringUtil.isNotEmpty(conditionCode)) {
            return tableCode + "." + conditionCode;
        }

        return "";
    }

    /**
     * 判断字符串是否为数字
     *
     * @param str 字符串
     * @return 是否为数字
     */
    private static boolean isNumeric(String str) {
        if (StringUtil.isEmpty(str)) {
            return false;
        }
        try {
            Double.parseDouble(str);
            return true;
        }
        catch (NumberFormatException e) {
            return false;
        }
    }

    /**
     * 构建安全的WHERE子句（返回完整的SQL字符串）
     *
     * @param inParams 入参列表
     * @param inParamConfigs 入参配置映射
     * @return 安全的WHERE子句SQL字符串
     */
    public static String buildSafeWhereClause(List<DatasetExecuteRequest.DatasetExecuteParam> inParams,
                                              Map<String, SsResExtAttribute> inParamConfigs) {
        if (CollectionUtils.isEmpty(inParams)) {
            return "";
        }

        List<String> conditions = new ArrayList<>();

        for (DatasetExecuteRequest.DatasetExecuteParam inParam : inParams) {
            String condition = buildSafeSingleWhereCondition(inParam, inParamConfigs);
            if (StringUtil.isNotEmpty(condition)) {
                conditions.add(condition);
            }
        }

        if (conditions.isEmpty()) {
            return "";
        }

        return String.join(" AND ", conditions);
    }

    /**
     * 构建安全的单个WHERE条件（返回完整的SQL字符串）
     *
     * @param inParam 入参
     * @param inParamConfigs 入参配置映射
     * @return 安全的条件SQL字符串
     */
    private static String buildSafeSingleWhereCondition(DatasetExecuteRequest.DatasetExecuteParam inParam,
                                                        Map<String, SsResExtAttribute> inParamConfigs) {
        if (StringUtil.isEmpty(inParam.getAttributeCode()) || StringUtil.isEmpty(inParam.getMatchType())) {
            return "";
        }

        SsResExtAttribute config = getParamConfig(inParam.getAttributeCode(), inParamConfigs);
        return buildConditionByMatchType(inParam.getAttributeCode(), inParam.getMatchType(), 
                                         inParam.getAttributeValueList(), config);
    }

    /**
     * 获取参数配置
     */
    private static SsResExtAttribute getParamConfig(String attributeCode, 
                                                   Map<String, SsResExtAttribute> inParamConfigs) {
        SsResExtAttribute config = inParamConfigs.get(attributeCode);
        if (config == null) {
            throw new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.param.config.not.found", attributeCode));
        }
        return config;
    }

    /**
     * 根据匹配类型构建安全的条件
     */
    private static String buildConditionByMatchType(String safeFieldName, String matchType, 
                                                    List<String> values, SsResExtAttribute config) {
        String lowerMatchType = matchType.toLowerCase();
        return switch (lowerMatchType) {
            case "=" -> buildSafeEqualityCondition(safeFieldName, values, config);
            case "!=" -> buildSafeInequalityCondition(safeFieldName, values, config);
            case ">", ">=", "<", "<=" -> buildComparisonCondition(safeFieldName, lowerMatchType, values, config);
            case "like", "not_like" -> buildLikeCondition(safeFieldName, lowerMatchType, values, config);
            case "between" -> buildSafeBetweenCondition(safeFieldName, values, config);
            case "in" -> buildSafeInCondition(safeFieldName, values, config);
            case "is_null" -> safeFieldName + " IS NULL";
            case "is_not_null" -> safeFieldName + " IS NOT NULL";
            default -> throw new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.match.type.unsupported", matchType));
        };
    }

    /**
     * 构建比较条件（>, >=, <, <=）
     */
    private static String buildComparisonCondition(String fieldName, String operator, 
                                                    List<String> values, SsResExtAttribute config) {
        validateSingleValue(values, operator);
        String safeValue = convertAndValidateValueToSqlString(values.get(0), config.getType(), config.getAttributeCode());
        return fieldName + " " + operator + " " + safeValue;
    }

    /**
     * 构建LIKE条件
     */
    private static String buildLikeCondition(String fieldName, String operator, 
                                             List<String> values, SsResExtAttribute config) {
        validateSingleValue(values, operator);
        String likeValue = "%" + values.get(0) + "%";
        String safeValue = formatStringValue(likeValue, config.getAttributeCode());
        return fieldName + " " + operator.toUpperCase() + " " + safeValue;
    }

    /**
     * 验证单个值
     */
    private static void validateSingleValue(List<String> values, String operator) {
        if (CollectionUtils.isEmpty(values) || values.size() != 1) {
            throw new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.condition.requires.one.value", operator));
        }
    }



    /**
     * 构建安全的等值条件 (=)
     */
    private static String buildSafeEqualityCondition(String fieldName, List<String> values, SsResExtAttribute config) {
        validateSingleValue(values, "=");
        String safeValue = convertAndValidateValueToSqlString(values.get(0), config.getType(), config.getAttributeCode());
        return fieldName + " = " + safeValue;
    }

    /**
     * 构建安全的不等值条件 (!=)
     */
    private static String buildSafeInequalityCondition(String fieldName, List<String> values, SsResExtAttribute config) {
        validateSingleValue(values, "!=");
        String safeValue = convertAndValidateValueToSqlString(values.get(0), config.getType(), config.getAttributeCode());
        return fieldName + " != " + safeValue;
    }


    /**
     * 构建安全的BETWEEN条件
     */
    private static String buildSafeBetweenCondition(String fieldName, List<String> values, SsResExtAttribute config) {
        if (CollectionUtils.isEmpty(values) || values.size() != 2) {
            throw new ByAiArgumentException(I18nUtil.get("resource.dataset.match.type.between.requires.two.values"));
        }
        String minValue = convertAndValidateValueToSqlString(values.get(0), config.getType(), config.getAttributeCode());
        String maxValue = convertAndValidateValueToSqlString(values.get(1), config.getType(), config.getAttributeCode());
        return fieldName + " BETWEEN " + minValue + " AND " + maxValue;
    }

    /**
     * 构建安全的IN条件
     */
    private static String buildSafeInCondition(String fieldName, List<String> values, SsResExtAttribute config) {
        if (CollectionUtils.isEmpty(values)) {
            throw new ByAiArgumentException(I18nUtil.get("resource.dataset.match.type.in.requires.at.least.one.value"));
        }
        List<String> safeValues = values.stream()
                .map(v -> convertAndValidateValueToSqlString(v, config.getType(), config.getAttributeCode()))
                .toList();
        String inValues = String.join(", ", safeValues);
        return fieldName + " IN (" + inValues + ")";
    }

    /**
     * 根据类型转换和校验参数值，返回格式化的SQL字符串
     */
    private static String convertAndValidateValueToSqlString(String value, String fieldType, String fieldName) {
        if (value == null) {
            return "NULL";
        }

        if (fieldType == null) {
            return formatStringValue(value, fieldName);
        }

        String upperType = fieldType.toUpperCase();
        if (isIntegerType(upperType)) {
            return validateAndConvertInteger(value, fieldName);
        }
        if (isNumberType(upperType)) {
            return validateAndConvertNumber(value, fieldName);
        }
        if (isBooleanType(upperType)) {
            return validateAndConvertBoolean(value, fieldName);
        }
        if (isDateType(upperType)) {
            return validateAndConvertDate(value, fieldName);
        }
        return formatStringValue(value, fieldName);
    }

    /**
     * 判断是否为整数类型
     */
    private static boolean isIntegerType(String type) {
        return "INTEGER".equals(type) || "INT".equals(type) || "BIGINT".equals(type) 
            || "SMALLINT".equals(type) || "TINYINT".equals(type);
    }

    /**
     * 判断是否为数字类型
     */
    private static boolean isNumberType(String type) {
        return "NUMBER".equals(type) || "DOUBLE".equals(type) || "FLOAT".equals(type) 
            || "DECIMAL".equals(type) || "NUMERIC".equals(type);
    }

    /**
     * 判断是否为布尔类型
     */
    private static boolean isBooleanType(String type) {
        return "BOOLEAN".equals(type) || "BIT".equals(type);
    }

    /**
     * 判断是否为日期类型
     */
    private static boolean isDateType(String type) {
        return "DATE".equals(type) || "DATETIME".equals(type) || "TIMESTAMP".equals(type);
    }

    /**
     * 验证并转换整数
     */
    private static String validateAndConvertInteger(String value, String fieldName) {
        try {
            Integer.parseInt(value);
            return value;
        }
        catch (NumberFormatException e) {
            ByAiArgumentException exception = new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.field.must.be.valid.integer", fieldName, value));
            exception.initCause(e);
            throw exception;
        }
    }

    /**
     * 验证并转换数字
     */
    private static String validateAndConvertNumber(String value, String fieldName) {
        try {
            Double.parseDouble(value);
            return value;
        }
        catch (NumberFormatException e) {
            ByAiArgumentException exception = new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.field.must.be.valid.number", fieldName, value));
            exception.initCause(e);
            throw exception;
        }
    }

    /**
     * 验证并转换布尔值
     */
    private static String validateAndConvertBoolean(String value, String fieldName) {
        if ("true".equalsIgnoreCase(value) || "1".equals(value)) {
            return "1";
        }
        if ("false".equalsIgnoreCase(value) || "0".equals(value)) {
            return "0";
        }
        throw new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.field.must.be.valid.boolean", fieldName, value));
    }

    /**
     * 验证并转换日期
     */
    private static String validateAndConvertDate(String value, String fieldName) {
        if (!value.matches("^\\d{4}-\\d{2}-\\d{2}(\\s\\d{2}:\\d{2}:\\d{2})?$")) {
            throw new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.field.must.be.valid.date", fieldName, value));
        }
        return "'" + value + "'";
    }

    /**
     * 格式化字符串值，进行安全校验
     */
    private static String formatStringValue(String value, String fieldName) {
        // 检查长度
        if (value.length() > 1000) {
            throw new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.field.content.too.long", fieldName));
        }

        // 检查是否包含危险字符
        String upperValue = value.toUpperCase();
        List<String> dangerousPatterns = Arrays.asList("UNION", "SELECT", "INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "EXEC", ";", "--");
        for (String pattern : dangerousPatterns) {
            if (upperValue.contains(pattern)) {
                throw new ByAiArgumentException(I18nUtil.get("dataset.sql.builder.field.contains.disallowed.content", fieldName));
            }
        }

        // 转义单引号
        return "'" + value.replace("'", "''") + "'";
    }


}

