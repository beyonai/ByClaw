package com.iwhalecloud.byai.manager.domain.resource.service;

import com.google.common.collect.Lists;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.application.service.ontology.OntologyApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceTypeEnum;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyActionSaveRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyBatchSaveRequest;
import com.iwhalecloud.byai.manager.dto.resource.DBDatasetSaveRequest;
import com.iwhalecloud.byai.manager.dto.resource.DatasetExecuteRequest;
import com.iwhalecloud.byai.manager.dto.resource.DatasetParamQueryResponse;
import com.iwhalecloud.byai.manager.dto.resource.DatasetParamSaveRequest;
import com.iwhalecloud.byai.manager.dto.resource.DatasetResponse;
import com.iwhalecloud.byai.manager.dto.resource.ResourceDatasetSaveDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtAttribute;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDbDataset;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtAttributeMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDbDatasetMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceRelDetailMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.exception.ByAiArgumentException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.manager.vo.resource.SsResExtAttributeVo;
import org.apache.commons.collections.CollectionUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.iwhalecloud.byai.manager.domain.resource.util.DatasetSqlBuilder;
import com.iwhalecloud.byai.common.util.StringUtil;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import static com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode.ERROR_CODE_50500;

/**
 * 数据集扩展服务类
 *
 * @author zzh
 */
@Service
public class SsResExtDbDatasetService {

    private static final Logger logger = LoggerFactory.getLogger(SsResExtDbDatasetService.class);

    @Autowired
    private SsResExtDbDatasetMapper ssResExtDbDatasetMapper;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private SsResExtAttributeMapper ssResExtAttributeMapper;

    @Autowired
    private OntologyApplicationService ontologyApplicationService;

    @Autowired
    private SsResourceRelDetailMapper ssResourceRelDetailMapper;

    /**
     * 保存或更新数据集信息
     *
     * @param request 请求参数
     */
    public void saveOrUpdate(DBDatasetSaveRequest request) {
        // 判断资源数据集是否存在
        validateResourceExist(request.getResourceId());

        // 查询资源数据集配置是否已存在
        SsResExtDbDataset dataset = ssResExtDbDatasetMapper.selectByResourceId(request.getResourceId());
        final Date now = new Date();
        boolean isUpdate = true;
        SsResExtDbDataset oldDataset = dataset;
        if (dataset == null) {
            isUpdate = false;
            dataset = new SsResExtDbDataset();
            dataset.setResourceId(request.getResourceId());
            dataset.setDatasetId(SequenceService.nextVal());
            dataset.setCreateTime(now);
        }
        dataset.setUpdateTime(now);
        if (StringUtil.isNotEmpty(request.getTableLocation())) {
            dataset.setTableLocation(request.getTableLocation());
        }

        // 设置创建人
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (currentUserId != null && currentUserId != Integer.MIN_VALUE) {
            dataset.setCreateBy(String.valueOf(currentUserId));
        }

        // 将 tableJoinInfo 对象转换为 JSON 字符串存储 并生成execute_sql
        if (request.getTableJoinInfo() != null) {
            String executeSql = DatasetSqlBuilder.buildSql(request.getTableJoinInfo(), dataset,
                request.getDataSourceId());
            dataset.setExecuteSql(executeSql);
            dataset.setTableJoinInfo(JSON.toJSONString(request.getTableJoinInfo()));
        }

        if (isUpdate) {
            dataset.setUpdateTime(now);
            ssResExtDbDatasetMapper.updateById(dataset);
            // 入参出参更新 (对象的、动作的)
            updateInOutParam(request, oldDataset);
        }
        else {
            // 新增
            ssResExtDbDatasetMapper.insert(dataset);
        }
    }

    /**
     * 更新入参出参 根据新的 tableJoinInfo 与旧的 tableJoinInfo 比对，删除不存在的字段和表的参数
     *
     * @param request 请求参数
     * @param oldDataset 数据集信息
     */
    private void updateInOutParam(DBDatasetSaveRequest request, SsResExtDbDataset oldDataset) {
        if (request == null || oldDataset == null) {
            return;
        }

        // 如果新的 tableJoinInfo 为空，不处理
        if (request.getTableJoinInfo() == null) {
            return;
        }

        // 如果旧的 tableJoinInfo 为空，不处理（新增场景）
        if (StringUtil.isEmpty(oldDataset.getTableJoinInfo())) {
            return;
        }

        try {
            Map<String, Object> newTableJoinInfo = DatasetSqlBuilder.convertToMap(request.getTableJoinInfo());
            Map<String, Object> oldTableJoinInfo = DatasetSqlBuilder.convertToMap(oldDataset.getTableJoinInfo());

            if (newTableJoinInfo == null || oldTableJoinInfo == null) {
                return;
            }

            // 处理主表变化
            if (handleMainTableChange(newTableJoinInfo, oldTableJoinInfo, request.getResourceId())) {
                return;
            }

            // 比较字段和表，收集需要删除的参数
            collectAttributesAndDelete(newTableJoinInfo, request.getResourceId());
        }
        catch (Exception e) {
            logger.error("更新入参出参失败，resourceId: {}", request.getResourceId(), e);
            // 不抛出异常，避免影响主流程
            throw new BaseException(I18nUtil.get("resource.dataset.update.params.failed", e.getMessage()), e);
        }
    }

    /**
     * 根据资源ID查询数据集信息
     *
     * @param resourceId 资源标识
     * @return 数据集信息
     */
    public SsResExtDbDataset findByResourceId(Long resourceId) {
        if (resourceId == null) {
            return null;
        }
        return ssResExtDbDatasetMapper.selectByResourceId(resourceId);
    }

    /**
     * 根据资源ID查询数据集信息列表（防御性，不限条数）
     *
     * @param resourceId 资源标识
     * @return 数据集信息列表
     */
    public List<SsResExtDbDataset> findListByResourceId(Long resourceId) {
        if (resourceId == null) {
            return Collections.emptyList();
        }
        return ssResExtDbDatasetMapper.selectListByResourceId(resourceId);
    }

    /**
     * 根据资源ID查询数据集配置并转换为响应DTO
     *
     * @param resourceId 资源标识
     * @return 数据集响应DTO，如果不存在则返回null
     */
    public DatasetResponse queryDatasetResponse(Long resourceId) {
        if (resourceId == null) {
            return null;
        }

        SsResExtDbDataset dataset = findByResourceId(resourceId);
        if (dataset == null) {
            return null;
        }

        // 转换为响应DTO
        DatasetResponse response = new DatasetResponse();
        response.setDatasetId(dataset.getDatasetId());
        response.setResourceId(dataset.getResourceId());
        response.setTableLocation(dataset.getTableLocation());
        response.setExecuteSql(dataset.getExecuteSql());
        response.setCreateBy(dataset.getCreateBy());
        response.setCreateTime(dataset.getCreateTime());
        response.setUpdateTime(dataset.getUpdateTime());

        // 将 tableJoinInfo JSON 字符串转换为对象
        if (StringUtil.isNotEmpty(dataset.getTableJoinInfo())) {
            try {
                response.setTableJoinInfo(JSON.parseObject(dataset.getTableJoinInfo()));
            }
            catch (Exception e) {
                // 如果解析失败，尝试解析为数组
                try {
                    response.setTableJoinInfo(JSON.parseArray(dataset.getTableJoinInfo()));
                }
                catch (Exception ex) {
                    // 解析失败，返回原始字符串
                    response.setTableJoinInfo(dataset.getTableJoinInfo());
                }
            }
        }

        return response;
    }

    /**
     * 根据数据集ID查询
     *
     * @param datasetId 数据集标识
     * @return 数据集信息
     */
    public SsResExtDbDataset findById(Long datasetId) {
        if (datasetId == null) {
            return null;
        }
        return ssResExtDbDatasetMapper.selectById(datasetId);
    }

    /**
     * 删除数据集
     *
     * @param resourceId 资源标识
     */
    public void deleteByResourceId(Long resourceId) {
        if (resourceId == null) {
            return;
        }
        LambdaQueryWrapper<SsResExtDbDataset> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(SsResExtDbDataset::getResourceId, resourceId);
        ssResExtDbDatasetMapper.delete(wrapper);
    }

    /**
     * 创建数据集资源
     *
     * @param dto 数据集资源信息
     * @return 资源标识
     */
    public SsResource createDBDataSetResource(ResourceDatasetSaveDto dto) {
        // 校验资源名称
        validateResourceNameFormat(dto.getResourceName());
        // 校验数据集名称是否存在
        isResourceNameExists(dto.getResourceName(), dto.getResourceBizType());
        SsResource resource = new SsResource();
        BeanUtils.copyProperties(dto, resource);
        resource.setResourceType(ResourceTypeEnum.ATOM.getCode());
        // 默认草稿类型
        resource.setResourceStatus(ResourceStatus.DRAFT.getNum());
        // 设置创建人和创建时间
        final Long currentUserId = CurrentUserHolder.getCurrentUserId();
        final Date now = new Date();
        resource.setCreateBy(currentUserId);
        resource.setCreateTime(now);
        resource.setUpdateBy(currentUserId);
        resource.setUpdateTime(now);
        resource.setResourceId(SequenceService.nextVal());
        // 设置企业ID
        resource.setComAcctId(CurrentUserHolder.getEnterpriseId());
        // 默认设置成hosted
        resource.setHostType("hosted");
        // 设置版本信息：草稿版本初始化为1，正式版本初始化为-1
        resource.setResourceDVerid(1L);
        resource.setResourceRVerid(-1L);
        // 设置resourceCode
        resource.setResourceCode(
            resource.getSystemCode() + "_" + resource.getResourceBizType() + "_" + resource.getResourceId());
        ssResourceMapper.insert(resource);
        return resource;
    }

    /**
     * 校验资源名称格式 只允许中文、英文（大小写）、数字和下划线
     *
     * @param resourceName 资源名称
     */
    private void validateResourceNameFormat(String resourceName) {
        if (resourceName == null || resourceName.trim().isEmpty()) {
            throw new ByAiArgumentException(I18nUtil.get("resourcecreation.processor.name.empty"));
        }

        // 正则表达式：只允许中文、英文（大小写）、数字和下划?
        String pattern = "^[\\u4e00-\\u9fa5a-zA-Z0-9_]+$";

        if (!resourceName.matches(pattern)) {
            throw new ByAiArgumentException(
                I18nUtil.get("resourcecreation.processor.name.invalid.format", resourceName));
        }
    }

    private void isResourceNameExists(String resourceName, String resourceBizType) {
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResource::getResourceName, resourceName).eq(SsResource::getResourceBizType, resourceBizType);
        List<SsResource> ssResources = ssResourceMapper.selectList(queryWrapper);
        if (CollectionUtils.isNotEmpty(ssResources)) {
            throw new ByAiArgumentException(I18nUtil.get("resourcecreation.processor.name.exists", resourceName));
        }
    }

    /**
     * 保存数据集入参和出参
     *
     * @param request 参数保存请求
     */
    public void saveDatasetParams(DatasetParamSaveRequest request) {
        Long resourceId = request.getResourceId();
        SsResource ssResource = ssResourceMapper.selectById(resourceId);
        if (ssResource == null) {
            throw new BaseException(ERROR_CODE_50500, I18nUtil.get("resource.object.not.exist", resourceId));
        }

        // 查询数据集配置，获取 tableJoinInfo
        SsResExtDbDataset dataset = findByResourceId(resourceId);
        if (dataset == null) {
            throw new ByAiArgumentException(I18nUtil.get("resource.dataset.not.exist", resourceId));
        }

        // 解析 tableJoinInfo，提取所有可用字段
        Map<String, String> aliasMap = new HashMap<>();
        Set<String> validFields = extractValidFieldsFromTableJoinInfo(dataset.getTableJoinInfo(), aliasMap);

        // 先删除该资源ID下已有的入参和出参
        deleteDatasetParamsByResourceId(resourceId);

        List<SsResExtAttributeVo> attributeList = new ArrayList<>();

        // 处理入参列表
        if (!CollectionUtils.isEmpty(request.getInParamList())) {
            int sort = 1;
            for (DatasetParamSaveRequest.DatasetParamItem item : request.getInParamList()) {
                // 验证字段是否存在于数据集中
                if (!isFiledValid(item, validFields)) {
                    throw new ByAiArgumentException(I18nUtil.get("resource.dataset.field.not.exist",
                        item.getFieldCode(), item.getSourceTableCode()));
                }
                SsResExtAttributeVo attribute = convertToAttribute(item, resourceId, "in_param", sort++);
                attributeList.add(attribute);
            }
        }

        // 处理出参列表
        if (!CollectionUtils.isEmpty(request.getOutParamList())) {
            int sort = 1;
            for (DatasetParamSaveRequest.DatasetParamItem item : request.getOutParamList()) {
                // 验证字段是否存在于数据集中
                if (!isFiledValid(item, validFields)) {
                    throw new ByAiArgumentException(I18nUtil.get("resource.dataset.field.not.exist",
                        item.getFieldCode(), item.getSourceTableCode()));
                }
                SsResExtAttributeVo attribute = convertToAttribute(item, resourceId, "out_param", sort++);
                attribute.setSourceTableCode(item.getSourceTableCode());
                attributeList.add(attribute);
            }
        }
        // 根据attributeCode去重，并转换为实体类，设置attributeType为basic
        List<SsResExtAttribute> ssResExtAttributes = attributeList.stream()
            .collect(Collectors.groupingBy(SsResExtAttributeVo::getAttributeCode)).values().stream().map(group -> {
                SsResExtAttributeVo firstVo = group.get(0);
                SsResExtAttribute ssResExtAttribute = new SsResExtAttribute();
                BeanUtils.copyProperties(firstVo, ssResExtAttribute);
                ssResExtAttribute.setAttributeCode(
                    StringUtil.isNotEmpty(firstVo.getAlias()) ? firstVo.getAlias() : firstVo.getAttributeCode());
                ssResExtAttribute.setAttributeType("basic");
                return ssResExtAttribute;
            }).collect(Collectors.toList());

        // 批量插入
        if (!CollectionUtils.isEmpty(ssResExtAttributes)) {
            ssResExtAttributeMapper.insertBatch(ssResExtAttributes);
            // 保存动作的属性(为动作使用)
            saveParamsAction(attributeList, ssResource);
        }
    }

    private void saveParamsAction(List<SsResExtAttributeVo> attributeList, SsResource ssResource) {
        OntologyActionSaveRequest actionSaveRequest = new OntologyActionSaveRequest();
        actionSaveRequest.setResourceId(ssResource.getResourceId());
        actionSaveRequest.setName(ssResource.getResourceName());
        actionSaveRequest.setDesc(ssResource.getResourceDesc());
        actionSaveRequest.setAttributes(null);
        OntologyBatchSaveRequest.ActionInfo actionInfo = new OntologyBatchSaveRequest.ActionInfo();
        actionInfo.setResourceId(null);
        actionInfo.setName(ssResource.getResourceName() + "_ACTION");
        actionInfo.setDesc(ssResource.getResourceDesc() + "_ACTION");
        actionInfo.setCode(ssResource.getResourceCode() + "_ACTION");
        actionInfo.setAttributes(Lists.newArrayList());
        List<OntologyBatchSaveRequest.ActionAttribute> actionAttributes = new ArrayList<>();
        for (SsResExtAttributeVo attribute : attributeList) {
            OntologyBatchSaveRequest.ActionAttribute actionAttribute = new OntologyBatchSaveRequest.ActionAttribute();
            BeanUtils.copyProperties(attribute, actionAttribute);
            actionAttribute.setExtAttributeId(SequenceService.nextVal());
            actionAttribute.setSourceTableCode(attribute.getSourceTableCode());
            actionAttribute.setAttributeCode(
                StringUtil.isNotEmpty(attribute.getAlias()) ? attribute.getAlias() : attribute.getAttributeCode());
            // 术语相关属性填充
            actionAttribute.setTermField(attribute.getTermField());
            actionAttribute.setTermDataType(attribute.getTermDataType());
            actionAttribute.setTermTypeName(attribute.getTermTypeName());
            actionAttribute.setDatasetId(attribute.getDatasetId());
            actionAttribute.setTermTypeCode(attribute.getTermTypeCode());
            actionAttribute.setPerDataScopeType(attribute.getPerDataScopeType());
            actionAttributes.add(actionAttribute);
        }
        actionInfo.setAttributes(actionAttributes);
        actionSaveRequest.setActions(List.of(actionInfo));
        ontologyApplicationService.saveOntologyActionInfos(actionSaveRequest);
    }

    /**
     * 删除数据集参数（入参和出参）
     *
     * @param resourceId 资源标识
     */
    public void deleteDatasetParamsByResourceId(Long resourceId) {
        if (resourceId == null) {
            return;
        }

        // 查出对象关联的动作资源ID 并删除属性
        List<SsResourceRelDetail> ssResourceRelDetails = ssResourceRelDetailMapper
            .selectList(new LambdaQueryWrapper<SsResourceRelDetail>().eq(SsResourceRelDetail::getResourceId, resourceId)
                .select(SsResourceRelDetail::getRelResourceId));
        List<Long> list = new ArrayList<>(
            ssResourceRelDetails.stream().map(SsResourceRelDetail::getRelResourceId).toList());
        if (CollectionUtils.isNotEmpty(list)) {
            // 删除对象关联的动作资源
            LambdaQueryWrapper<SsResourceRelDetail> wrapper = new LambdaQueryWrapper<SsResourceRelDetail>()
                .eq(SsResourceRelDetail::getResourceId, resourceId);
            ssResourceRelDetailMapper.delete(wrapper);
            // 删除对象关联的动作资源
            LambdaQueryWrapper<SsResource> ssResourceWrapper = new LambdaQueryWrapper<>();
            ssResourceWrapper.in(SsResource::getResourceId, list);
            ssResourceMapper.delete(ssResourceWrapper);
        }
        list.add(resourceId);
        LambdaQueryWrapper<SsResExtAttribute> wrapper = new LambdaQueryWrapper<>();
        wrapper.in(SsResExtAttribute::getResourceId, list);
        ssResExtAttributeMapper.delete(wrapper);
    }

    /**
     * 将请求参数转换为 SsResExtAttribute 实体
     *
     * @param item 参数项
     * @param resourceId 资源ID
     * @param attributeType 属性类型（in_param 或 out_param）
     * @param sort 排序
     * @return SsResExtAttribute
     */
    private SsResExtAttributeVo convertToAttribute(DatasetParamSaveRequest.DatasetParamItem item, Long resourceId,
        String attributeType, Integer sort) {
        SsResExtAttributeVo attribute = new SsResExtAttributeVo();
        attribute.setExtAttributeId(SequenceService.nextVal());
        attribute.setResourceId(resourceId);
        attribute.setAttributeType(attributeType);

        // 使用最终字段名称作为attributeCode
        attribute.setAttributeCode(StringUtil.isNotEmpty(item.getAlias()) ? item.getAlias() : item.getFieldName());

        attribute.setType(convertFieldType(item.getFieldType()));
        attribute.setIsRequired(item.getIsRequired());
        attribute.setTermTypeCode(item.getTermTypeCode());
        attribute.setTermField(item.getTermField());
        attribute.setAttributeDesc(item.getAttributeDesc());
        attribute.setAttributeValue(item.getFieldName());
        attribute.setSort(sort);
        attribute.setAlias(item.getAlias());
        attribute.setDatasetId(item.getDatasetId());
        attribute.setTermDataType(item.getTermDataType());
        attribute.setTermTypeName(item.getTermTypeName());
        attribute.setPerDataScopeType(item.getPerDataScopeType());
        // 构建 extMeta JSON，包含源表信息和原始字段名
        Map<String, Object> extMetaMap = new HashMap<>();
        extMetaMap.put("sourceTableCode", item.getSourceTableCode());
        extMetaMap.put("filedCode", item.getFieldCode());
        if (StringUtil.isNotEmpty(item.getDatasetId())) {
            extMetaMap.put("datasetId", item.getDatasetId());
        }
        if (StringUtil.isNotEmpty(item.getTermDataType())) {
            extMetaMap.put("termDataType", item.getTermDataType());
        }
        if (StringUtil.isNotEmpty(item.getTermTypeName())) {
            extMetaMap.put("termTypeName", item.getTermTypeName());
        }

        // 设置权限数据
        setPriv(extMetaMap, item);
        attribute.setExtMeta(JSON.toJSONString(extMetaMap));
        return attribute;
    }

    private void setPriv(Map<String, Object> extMetaMap, DatasetParamSaveRequest.DatasetParamItem item) {
        if (item.getPerDataScopeType() != null) {
            extMetaMap.put("perDataScopeType", item.getPerDataScopeType());
        }
    }

    /**
     * 转换字段类型 S => String, D => Date, I => Integer, N => Number, A => Array, O => Object, E => Enum
     *
     * @param fieldType 前端字段类型
     * @return 数据库存储的类型
     */
    private String convertFieldType(String fieldType) {
        if (fieldType == null || fieldType.trim().isEmpty()) {
            return "String";
        }

        return switch (fieldType.toUpperCase()) {
            case "S" -> "String";
            case "D" -> "Date";
            case "I" -> "Integer";
            case "N" -> "Number";
            case "A" -> "Array";
            case "O" -> "Object";
            case "E" -> "Enum";
            default -> fieldType; // 如果不在映射范围内，直接返回原值
        };
    }

    /**
     * 从 tableJoinInfo JSON 中提取所有有效的字段 字段格式：sourceTableCode:fieldCode
     *
     * @param tableJoinInfoJson tableJoinInfo JSON 字符串
     * @return 有效字段集合，格式为 "sourceTableCode:fieldCode"
     */
    private Set<String> extractValidFieldsFromTableJoinInfo(String tableJoinInfoJson, Map<String, String> aliasMap) {
        Set<String> validFields = new HashSet<>();

        if (StringUtil.isEmpty(tableJoinInfoJson)) {
            return validFields;
        }

        try {
            // 解析 JSON
            @SuppressWarnings("unchecked")
            Map<String, Object> tableJoinInfo = JSON.parseObject(tableJoinInfoJson, Map.class);
            if (tableJoinInfo == null) {
                return validFields;
            }

            // 获取 tableFieldInfoList
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> tableFieldInfoList = (List<Map<String, Object>>) tableJoinInfo
                .get("tableFieldInfoList");
            if (CollectionUtils.isEmpty(tableFieldInfoList)) {
                return validFields;
            }

            // 处理每个表的字段信息
            processTableFieldInfoList(tableFieldInfoList, validFields, aliasMap);
        }
        catch (Exception e) {
            logger.error("解析 tableJoinInfo 失败");
            ByAiArgumentException exception = new ByAiArgumentException("解析 tableJoinInfo 失败：" + e.getMessage());
            exception.initCause(e);
            throw exception;
        }

        return validFields;
    }

    /**
     * 处理表字段信息列表，提取有效字段
     *
     * @param tableFieldInfoList 表字段信息列表
     * @param validFields 有效字段集合
     */
    private void processTableFieldInfoList(List<Map<String, Object>> tableFieldInfoList, Set<String> validFields,
        Map<String, String> aliasMap) {
        for (Map<String, Object> tableFieldInfo : tableFieldInfoList) {
            // 获取 selectFieldList
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> selectFieldList = (List<Map<String, Object>>) tableFieldInfo
                .get("selectFieldList");
            if (CollectionUtils.isEmpty(selectFieldList)) {
                continue;
            }

            // 获取 tableCode（作为 sourceTableCode）
            String tableCode = (String) tableFieldInfo.get("tableCode");

            // 处理每个字段
            processSelectFieldList(selectFieldList, tableCode, validFields, aliasMap);
        }
    }

    /**
     * 处理选择字段列表，提取有效字段
     *
     * @param selectFieldList 选择字段列表
     * @param tableCode 表编码
     * @param validFields 有效字段集合
     * @param aliasMap 如果不为空则则存放alias与validField映射
     */
    private void processSelectFieldList(List<Map<String, Object>> selectFieldList, String tableCode,
        Set<String> validFields, Map<String, String> aliasMap) {
        for (Map<String, Object> field : selectFieldList) {
            String fieldCode = (String) field.get("fieldCode");
            String alias = (String) field.get("alias");

            // 如果字段中有 sourceTableCode，优先使用；否则使用 tableCode
            String sourceTableCode = (String) field.get("sourceTableCode");
            if (StringUtil.isEmpty(sourceTableCode)) {
                sourceTableCode = tableCode;
            }

            // 确定最终字段名称：alias优先，没有alias则使用fieldCode
            String finalFieldCode = StringUtil.isNotEmpty(alias) ? alias : fieldCode;

            // 构建字段标识：sourceTableCode:finalFieldName（确保唯一性）
            if (StringUtil.isNotEmpty(finalFieldCode) && StringUtil.isNotEmpty(sourceTableCode)) {
                validFields.add(sourceTableCode + ":" + finalFieldCode);
                if (StringUtil.isNotEmpty(alias)) {
                    aliasMap.put(sourceTableCode + ":" + finalFieldCode, alias);
                }
            }
        }
    }

    /**
     * 验证字段是否存在于数据集的字段列表中
     *
     * @param item 参数项
     * @param validFields 有效字段集合，格式为 "sourceTableCode:fieldCode:alisa"
     * @return 是否有效
     */
    private boolean isFiledValid(DatasetParamSaveRequest.DatasetParamItem item, Set<String> validFields) {
        if (item == null || StringUtil.isEmpty(item.getFieldCode())) {
            return false;
        }

        String sourceTableCode = item.getSourceTableCode();
        String fieldCode = item.getFieldCode();
        String alias = item.getAlias();

        // 构建字段标识：sourceTableCode:fieldCode
        String fieldKey = sourceTableCode + ":" + (StringUtil.isNotEmpty(alias) ? alias : fieldCode);

        return validFields.contains(fieldKey);
    }

    /**
     * 查询数据集参数设置（用于前端展示和回显）
     *
     * @param resourceId 资源标识
     * @return 数据集参数查询响应
     */
    public DatasetParamQueryResponse queryDatasetParams(Long resourceId) {
        if (resourceId == null) {
            throw new ByAiArgumentException(I18nUtil.get("resource.dataset.resource.id.not.empty"));
        }

        // 查询数据集配置
        SsResExtDbDataset dataset = findByResourceId(resourceId);
        if (dataset == null) {
            throw new ByAiArgumentException(I18nUtil.get("resource.dataset.not.exist", resourceId));
        }

        // 从 tableJoinInfo 中提取所有字段
        List<DatasetParamQueryResponse.DatasetParamField> allFields = extractAllFieldsFromTableJoinInfo(
            dataset.getTableJoinInfo());

        // 获取动作的resourceId
        List<Long> relResourceIds = getRelResourceIds(resourceId);
        List<SsResExtAttribute> savedInParams = new ArrayList<>();
        List<SsResExtAttribute> savedOutParams = new ArrayList<>();
        if (CollectionUtils.isNotEmpty(relResourceIds)) {
            // 查询已保存的入参和出参
            savedInParams = ssResExtAttributeMapper.selectByResourceIdAndType(relResourceIds.get(0), "in_param");
            savedOutParams = ssResExtAttributeMapper.selectByResourceIdAndType(relResourceIds.get(0), "out_param");
        }

        // 构建已保存字段的映射（用于快速查找）
        Map<String, SsResExtAttribute> savedInParamMap = buildFieldMap(savedInParams);
        Map<String, SsResExtAttribute> savedOutParamMap = buildFieldMap(savedOutParams);

        // 创建入参和出参列表（复制所有字段）
        List<DatasetParamQueryResponse.DatasetParamField> inParamList = buildParamFieldList(allFields, savedInParamMap);
        List<DatasetParamQueryResponse.DatasetParamField> outParamList = buildParamFieldList(allFields,
            savedOutParamMap);

        // 构建响应
        DatasetParamQueryResponse response = new DatasetParamQueryResponse();
        response.setInParamList(inParamList);
        response.setOutParamList(outParamList);

        return response;
    }

    /**
     * 从 tableJoinInfo JSON 中提取所有字段并转换为对象列表
     *
     * @param tableJoinInfoJson tableJoinInfo JSON 字符串
     * @return 字段列表
     */
    private List<DatasetParamQueryResponse.DatasetParamField> extractAllFieldsFromTableJoinInfo(
        String tableJoinInfoJson) {
        List<DatasetParamQueryResponse.DatasetParamField> fieldList = new ArrayList<>();

        if (StringUtil.isEmpty(tableJoinInfoJson)) {
            return fieldList;
        }

        try {
            // 解析 JSON
            @SuppressWarnings("unchecked")
            Map<String, Object> tableJoinInfo = JSON.parseObject(tableJoinInfoJson, Map.class);
            if (tableJoinInfo == null) {
                return fieldList;
            }

            // 获取 tableFieldInfoList
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> tableFieldInfoList = (List<Map<String, Object>>) tableJoinInfo
                .get("tableFieldInfoList");
            if (CollectionUtils.isEmpty(tableFieldInfoList)) {
                return fieldList;
            }

            // 遍历每个表的字段信息
            for (Map<String, Object> tableFieldInfo : tableFieldInfoList) {
                // 获取 selectFieldList
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> selectFieldList = (List<Map<String, Object>>) tableFieldInfo
                    .get("selectFieldList");
                if (CollectionUtils.isEmpty(selectFieldList)) {
                    continue;
                }

                // 获取 tableCode（作为 sourceTableCode）
                String tableCode = (String) tableFieldInfo.get("tableCode");

                // 遍历每个字段
                for (Map<String, Object> field : selectFieldList) {
                    DatasetParamQueryResponse.DatasetParamField paramField = new DatasetParamQueryResponse.DatasetParamField();
                    paramField.setFieldCode((String) field.get("fieldCode"));
                    paramField.setFieldName((String) field.get("fieldName"));
                    paramField.setAlias((String) field.get("alias"));
                    paramField.setFieldType((String) field.get("fieldType"));

                    // 如果字段中有 sourceTableCode，优先使用；否则使用 tableCode
                    String sourceTableCode = (String) field.get("sourceTableCode");
                    if (StringUtil.isEmpty(sourceTableCode)) {
                        sourceTableCode = tableCode;
                    }
                    paramField.setSourceTableCode(sourceTableCode);

                    fieldList.add(paramField);
                }
            }
        }
        catch (Exception e) {
            ByAiArgumentException exception = new ByAiArgumentException("解析 tableJoinInfo 失败：" + e.getMessage());
            exception.initCause(e);
            throw exception;
        }

        return fieldList;
    }

    /**
     * 构建已保存字段的映射（用于快速查找） key: sourceTableCode:finalFieldName（使用最终字段名称） value: SsResExtAttribute
     *
     * @param attributes 已保存的属性列表
     * @return 字段映射
     */
    private Map<String, SsResExtAttribute> buildFieldMap(List<SsResExtAttribute> attributes) {
        Map<String, SsResExtAttribute> fieldMap = new HashMap<>();

        if (CollectionUtils.isEmpty(attributes)) {
            return fieldMap;
        }

        for (SsResExtAttribute attribute : attributes) {
            // 从 extMeta 中获取 sourceTableCode
            String sourceTableCode = extractSourceTableCodeFromExtMeta(attribute.getExtMeta());

            // 使用最终字段名称（attributeCode已经是最终字段名称）
            if (StringUtil.isNotEmpty(sourceTableCode) && StringUtil.isNotEmpty(attribute.getAttributeCode())) {
                String fieldKey = sourceTableCode + ":" + attribute.getAttributeCode();
                fieldMap.put(fieldKey, attribute);
            }
        }

        return fieldMap;
    }

    /**
     * 复制字段对象
     *
     * @param source 源字段
     * @return 复制的字段
     */
    private DatasetParamQueryResponse.DatasetParamField copyField(DatasetParamQueryResponse.DatasetParamField source) {
        DatasetParamQueryResponse.DatasetParamField target = new DatasetParamQueryResponse.DatasetParamField();
        target.setFieldCode(source.getFieldCode());
        target.setFieldName(source.getFieldName());
        target.setSourceTableCode(source.getSourceTableCode());
        target.setFieldType(source.getFieldType());
        target.setAlias(source.getAlias());
        return target;
    }

    /**
     * 构建参数字段列表（匹配已保存的参数并回显）
     *
     * @param allFields 所有字段列表
     * @param savedParamMap 已保存参数的映射
     * @return 参数字段列表
     */
    private List<DatasetParamQueryResponse.DatasetParamField> buildParamFieldList(
        List<DatasetParamQueryResponse.DatasetParamField> allFields, Map<String, SsResExtAttribute> savedParamMap) {
        List<DatasetParamQueryResponse.DatasetParamField> paramList = new ArrayList<>();

        for (DatasetParamQueryResponse.DatasetParamField field : allFields) {
            // 创建字段副本
            DatasetParamQueryResponse.DatasetParamField paramField = copyField(field);
            // 构建字段标识
            String fieldKey = field.getSourceTableCode() + ":"
                + (StringUtil.isNotEmpty(field.getAlias()) ? field.getAlias() : field.getFieldCode());
            // 匹配已保存的参数
            SsResExtAttribute savedParam = savedParamMap.get(fieldKey);
            if (savedParam != null) {
                paramField.setIsSelected(1);
                paramField.setIsRequired(savedParam.getIsRequired());
                paramField.setAttributeDesc(savedParam.getAttributeDesc());
                paramField.setTermTypeCode(savedParam.getTermTypeCode());
                paramField.setTermField(savedParam.getTermField());
                String extMeta = savedParam.getExtMeta();
                if (StringUtil.isNotEmpty(extMeta)) {
                    Map<String, Object> extMetaMap = JSON.parseObject(extMeta, Map.class);
                    MapParamUtil.copyProperties(extMetaMap, paramField);
                }
            }
            else {
                paramField.setIsSelected(0);
            }
            paramList.add(paramField);
        }

        return paramList;
    }

    /**
     * 从 extMeta JSON 中提取 sourceTableCode
     *
     * @param extMetaJson extMeta JSON 字符串
     * @return sourceTableCode，如果解析失败则返回 null
     */
    private String extractSourceTableCodeFromExtMeta(String extMetaJson) {
        if (StringUtil.isEmpty(extMetaJson)) {
            return null;
        }

        try {
            Map extMeta = JSON.parseObject(extMetaJson, Map.class);
            Map extMetaMap = JSON.parseObject((String) extMeta.get("extMeta"), Map.class);
            return StringUtil.isNotEmpty((String) extMeta.get("sourceTableCode"))
                ? (String) extMeta.get("sourceTableCode")
                : (String) extMetaMap.get("sourceTableCode");
        }
        catch (Exception e) {
            // 解析失败，记录日志但不影响主流程
            logger.debug("解析 extMeta 失败，extMeta: {}", extMetaJson, e);
            throw new BaseException(ERROR_CODE_50500, I18nUtil.get("resource.dataset.parse.extmeta.failed"));
        }
    }

    /**
     * 删除数据库数据集资源
     *
     * @param resourceId 资源ID
     */
    public void deleteDBDataSetResource(Long resourceId) {
        // 判断资源是否存在
        validateResourceExist(resourceId);
        List<Long> resourceIds = new ArrayList<>();
        resourceIds.add(resourceId);

        // 删除数据集配置
        LambdaQueryWrapper<SsResExtDbDataset> datasetWrapper = new LambdaQueryWrapper<>();
        datasetWrapper.eq(SsResExtDbDataset::getResourceId, resourceId);
        ssResExtDbDatasetMapper.delete(datasetWrapper);

        // 获取对象的动作
        List<Long> relResourceIds = getRelResourceIds(resourceId);
        if (CollectionUtils.isNotEmpty(relResourceIds)) {
            resourceIds.addAll(relResourceIds);
            LambdaQueryWrapper<SsResourceRelDetail> relWrapperDel = new LambdaQueryWrapper<>();
            relWrapperDel.eq(SsResourceRelDetail::getResourceId, resourceId);
            ssResourceRelDetailMapper.delete(relWrapperDel);
        }
        // 删除对象动作
        ssResourceMapper.deleteBatchIds(resourceIds);
        // 删除入参出参
        LambdaQueryWrapper<SsResExtAttribute> attributeWrapper = new LambdaQueryWrapper<>();
        attributeWrapper.in(SsResExtAttribute::getResourceId, resourceIds);
        ssResExtAttributeMapper.delete(attributeWrapper);
    }

    /**
     * 获取动作的resourceId
     */
    private List<Long> getRelResourceIds(Long resourceId) {
        LambdaQueryWrapper<SsResourceRelDetail> relWrapper = new LambdaQueryWrapper<>();
        relWrapper.eq(SsResourceRelDetail::getResourceId, resourceId);
        relWrapper.select(SsResourceRelDetail::getRelResourceId);
        List<SsResourceRelDetail> ssResourceRelDetails = ssResourceRelDetailMapper.selectList(relWrapper);
        return ssResourceRelDetails.stream().map(SsResourceRelDetail::getRelResourceId).toList();
    }

    /**
     * 校验资源是否存在
     *
     * @param resourceId 资源ID
     */
    private void validateResourceExist(Long resourceId) {
        // 查看资源是否存在
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResource::getResourceId, resourceId);
        boolean exists = ssResourceMapper.exists(queryWrapper);
        if (!exists) {
            throw new BaseException(ERROR_CODE_50500, I18nUtil.get("resource.not.found"));
        }
    }

    /**
     * 构建执行查询的 SELECT 子句
     *
     * @param outParams 出参列表
     * @return SELECT 子句
     */
    private String buildSelectClauseForExecution(List<SsResExtAttribute> outParams) {
        if (CollectionUtils.isEmpty(outParams)) {
            // 如果没有指定出参，返回所有字段
            return "*";
        }

        List<String> selectFields = outParams.stream().map(SsResExtAttribute::getAttributeCode).toList();

        if (selectFields.isEmpty()) {
            return "*";
        }

        return String.join(", ", selectFields);
    }

    /**
     * 构建安全的WHERE子句（返回完整的SQL字符串）
     *
     * @param inParamList 请求的入参列表
     * @param inParamConfigs 入参配置映射
     * @return 安全的WHERE子句SQL字符串
     */
    private String buildSafeWhereClauseForExecution(List<DatasetExecuteRequest.DatasetExecuteParam> inParamList,
        Map<String, SsResExtAttribute> inParamConfigs) {

        return DatasetSqlBuilder.buildSafeWhereClause(inParamList, inParamConfigs);
    }

    /**
     * 验证执行请求
     */
    private Long validateExecuteRequest(DatasetExecuteRequest request) {
        if (request == null || request.getResourceId() == null) {
            throw new ByAiArgumentException(I18nUtil.get("resource.dataset.request.params.not.empty"));
        }

        Long resourceId = request.getResourceId();
        LambdaQueryWrapper<SsResource> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(SsResource::getResourceId, resourceId);
        if (!ssResourceMapper.exists(wrapper)) {
            throw new BaseException(I18nUtil.get("resource.object.resource.not.exist", resourceId));
        }
        return resourceId;
    }

    /**
     * 获取执行所需的关联资源ID
     */
    private Long getRelResourceIdForExecution(Long resourceId) {
        LambdaQueryWrapper<SsResourceRelDetail> relWrapper = new LambdaQueryWrapper<>();
        relWrapper.eq(SsResourceRelDetail::getResourceId, resourceId);
        relWrapper.select(SsResourceRelDetail::getRelResourceId);
        List<SsResourceRelDetail> ssResourceRelDetails = ssResourceRelDetailMapper.selectList(relWrapper);
        if (CollectionUtils.isEmpty(ssResourceRelDetails)) {
            throw new BaseException(I18nUtil.get("resource.object.action.not.exist", resourceId));
        }
        return ssResourceRelDetails.get(0).getRelResourceId();
    }

    /**
     * 获取执行所需的入参列表
     */
    private List<SsResExtAttribute> getInParamsForExecution(Long relResourceId) {
        List<SsResExtAttribute> attributeList = ssResExtAttributeMapper.selectByResourceId(relResourceId);
        return attributeList.stream().filter(attribute -> "in_param".equals(attribute.getAttributeType())).toList();
    }

    /**
     * 获取执行所需的出参列表
     */
    private List<SsResExtAttribute> getOutParamsForExecution(Long relResourceId) {
        List<SsResExtAttribute> attributeList = ssResExtAttributeMapper.selectByResourceId(relResourceId);
        return attributeList.stream().filter(attribute -> "out_param".equals(attribute.getAttributeType())).toList();
    }

    /**
     * 验证并获取数据集配置
     */
    private SsResExtDbDataset validateAndGetDatasetForExecution(Long resourceId) {
        SsResExtDbDataset dataset = findByResourceId(resourceId);
        if (dataset == null) {
            throw new ByAiArgumentException(I18nUtil.get("resource.dataset.not.exist", resourceId));
        }
        if (dataset.getMainDataSourceId() == null) {
            throw new ByAiArgumentException(I18nUtil.get("resource.dataset.data.source.id.not.empty", resourceId));
        }
        if (StringUtil.isEmpty(dataset.getExecuteSql())) {
            throw new ByAiArgumentException(I18nUtil.get("resource.dataset.sql.empty"));
        }
        return dataset;
    }

    /**
     * 构建最终SQL
     */
    private String buildFinalSqlForExecution(SsResExtDbDataset dataset, List<SsResExtAttribute> inParams,
        List<SsResExtAttribute> outParams, DatasetExecuteRequest request) {
        Map<String, SsResExtAttribute> inParamConfigMap = inParams.stream()
            .collect(Collectors.toMap(SsResExtAttribute::getAttributeCode, attr -> attr));

        String selectClause = buildSelectClauseForExecution(outParams);
        String whereClause = buildSafeWhereClauseForExecution(request.getInParamList(), inParamConfigMap);

        StringBuilder finalSql = new StringBuilder();
        finalSql.append("SELECT ").append(selectClause).append(" FROM (").append(dataset.getExecuteSql())
            .append(") dataset_base");
        if (StringUtil.isNotEmpty(whereClause)) {
            finalSql.append(" WHERE ").append(whereClause);
        }
        return finalSql.toString();
    }

    /**
     * 校验执行数据集查询的参数
     *
     * @param request 执行请求
     * @param inParams 入参配置
     */
    private void validateExecuteParams(DatasetExecuteRequest request, List<SsResExtAttribute> inParams) {
        // 1. 校验入参的matchType和attributeValueList是否匹配
        if (CollectionUtils.isNotEmpty(request.getInParamList())) {
            validateInParamMatchTypes(request.getInParamList());
        }

        // 2. 校验必填参数是否都已传递
        validateRequiredInParams(request.getInParamList(), inParams);

        // 3. 校验传递的参数是否都有效（不能传递多余的参数）
        if (CollectionUtils.isNotEmpty(request.getInParamList())) {
            validateInParamExists(request.getInParamList(), inParams);
        }

        // 4. 校验参数值类型是否匹配
        if (CollectionUtils.isNotEmpty(request.getInParamList())) {
            validateInParamValues(request.getInParamList(), inParams);
        }
    }

    /**
     * 校验入参的matchType和attributeValueList个数是否匹配
     *
     * @param inParamList 入参列表
     */
    private void validateInParamMatchTypes(List<DatasetExecuteRequest.DatasetExecuteParam> inParamList) {
        for (DatasetExecuteRequest.DatasetExecuteParam param : inParamList) {
            validateSingleParamMatchType(param);
        }
    }

    /**
     * 校验单个参数的匹配类型
     */
    private void validateSingleParamMatchType(DatasetExecuteRequest.DatasetExecuteParam param) {
        String matchType = param.getMatchType();
        List<String> attributeValueList = param.getAttributeValueList();

        if (StringUtil.isEmpty(matchType)) {
            throw new ByAiArgumentException(I18nUtil.get("resource.dataset.match.type.not.empty"));
        }

        String lowerMatchType = matchType.toLowerCase();
        if (isSingleValueMatchType(lowerMatchType)) {
            validateSingleValue(attributeValueList, matchType);
        }
        else if ("between".equals(lowerMatchType)) {
            validateBetweenValue(attributeValueList);
        }
        else if ("in".equals(lowerMatchType)) {
            validateInValue(attributeValueList);
        }
        else if (isNullMatchType(lowerMatchType)) {
            validateNullValue(attributeValueList, matchType);
        }
        else {
            throw new ByAiArgumentException(I18nUtil.get("resource.dataset.match.type.unsupported", matchType));
        }
    }

    /**
     * 判断是否为单值匹配类型
     */
    private boolean isSingleValueMatchType(String matchType) {
        return "=".equals(matchType) || "!=".equals(matchType) || ">".equals(matchType) || ">=".equals(matchType)
            || "<".equals(matchType) || "<=".equals(matchType) || "like".equals(matchType)
            || "not_like".equals(matchType);
    }

    /**
     * 判断是否为NULL匹配类型
     */
    private boolean isNullMatchType(String matchType) {
        return "is_null".equals(matchType) || "is_not_null".equals(matchType);
    }

    /**
     * 验证单值
     */
    private void validateSingleValue(List<String> attributeValueList, String matchType) {
        if (CollectionUtils.isEmpty(attributeValueList) || attributeValueList.size() != 1) {
            throw new ByAiArgumentException(
                I18nUtil.get("resource.dataset.match.type.requires.one.value", matchType));
        }
    }

    /**
     * 验证BETWEEN值
     */
    private void validateBetweenValue(List<String> attributeValueList) {
        if (CollectionUtils.isEmpty(attributeValueList) || attributeValueList.size() != 2) {
            throw new ByAiArgumentException(
                I18nUtil.get("resource.dataset.match.type.between.requires.two.values"));
        }
    }

    /**
     * 验证IN值
     */
    private void validateInValue(List<String> attributeValueList) {
        if (CollectionUtils.isEmpty(attributeValueList)) {
            throw new ByAiArgumentException(
                I18nUtil.get("resource.dataset.match.type.in.requires.at.least.one.value"));
        }
    }

    /**
     * 验证NULL值
     */
    private void validateNullValue(List<String> attributeValueList, String matchType) {
        if (CollectionUtils.isNotEmpty(attributeValueList)) {
            throw new ByAiArgumentException(
                I18nUtil.get("resource.dataset.match.type.no.value.required", matchType));
        }
    }

    /**
     * 校验必填参数是否都已传递
     *
     * @param requestInParams 请求中的入参
     * @param configInParams 配置的入参
     */
    private void validateRequiredInParams(List<DatasetExecuteRequest.DatasetExecuteParam> requestInParams,
        List<SsResExtAttribute> configInParams) {
        // 获取所有必填的入参配置
        List<SsResExtAttribute> requiredInParams = configInParams.stream()
            .filter(attr -> attr.getIsRequired() != null && attr.getIsRequired() == 1).toList();

        // 检查每个必填参数是否都已传递
        for (SsResExtAttribute requiredParam : requiredInParams) {
            boolean found = false;
            if (CollectionUtils.isNotEmpty(requestInParams)) {
                found = requestInParams.stream()
                    .anyMatch(requestParam -> requiredParam.getAttributeCode().equals(requestParam.getAttributeCode()));
            }
            if (!found) {
                throw new ByAiArgumentException(
                    I18nUtil.get("resource.dataset.required.param.not.passed", requiredParam.getAttributeCode()));
            }
        }
    }

    /**
     * 校验传递的参数是否都存在于配置中
     *
     * @param requestInParams 请求中的入参
     * @param configInParams 配置的入参
     */
    private void validateInParamExists(List<DatasetExecuteRequest.DatasetExecuteParam> requestInParams,
        List<SsResExtAttribute> configInParams) {
        // 创建配置参数的attributeCode映射
        Set<String> configAttributeCodes = configInParams.stream().map(SsResExtAttribute::getAttributeCode)
            .collect(Collectors.toSet());

        // 检查每个请求参数是否存在于配置中
        for (DatasetExecuteRequest.DatasetExecuteParam requestParam : requestInParams) {
            if (!configAttributeCodes.contains(requestParam.getAttributeCode())) {
                throw new ByAiArgumentException(
                    I18nUtil.get("resource.dataset.param.not.configured", requestParam.getAttributeCode()));
            }
        }
    }

    /**
     * 校验参数值类型是否匹配
     *
     * @param requestInParams 请求中的入参
     * @param configInParams 配置的入参
     */
    private void validateInParamValues(List<DatasetExecuteRequest.DatasetExecuteParam> requestInParams,
        List<SsResExtAttribute> configInParams) {
        // 创建配置参数的attributeCode到SsResExtAttribute的映射
        Map<String, SsResExtAttribute> configParamMap = configInParams.stream()
            .collect(Collectors.toMap(SsResExtAttribute::getAttributeCode, attr -> attr));

        for (DatasetExecuteRequest.DatasetExecuteParam requestParam : requestInParams) {
            SsResExtAttribute configParam = configParamMap.get(requestParam.getAttributeCode());
            if (configParam != null && CollectionUtils.isNotEmpty(requestParam.getAttributeValueList())) {
                String paramType = configParam.getType();
                if (StringUtil.isNotEmpty(paramType)) {
                    validateParamValueType(requestParam.getAttributeValueList(), paramType,
                        requestParam.getAttributeCode());
                }
            }
        }
    }

    /**
     * 校验参数值类型
     *
     * @param values 参数值列表
     * @param expectedType 期望的类型
     * @param paramCode 参数编码
     */
    private void validateParamValueType(List<String> values, String expectedType, String paramCode) {
        for (String value : values) {
            if (StringUtil.isEmpty(value)) {
                continue;
            }

            switch (expectedType.toUpperCase()) {
                case "INTEGER" -> {
                    try {
                        Integer.parseInt(value);
                    }
                    catch (NumberFormatException e) {
                        throw new ByAiArgumentException(
                            I18nUtil.get("resource.dataset.param.value.not.valid.integer", paramCode, value));
                    }
                }
                case "NUMBER" -> {
                    try {
                        Double.parseDouble(value);
                    }
                    catch (NumberFormatException e) {
                        throw new ByAiArgumentException(
                            I18nUtil.get("resource.dataset.param.value.not.valid.number", paramCode, value));
                    }
                }
                case "DATE" -> {
                    // 这里可以添加日期格式校验，如果需要的话
                    // 暂时只做基础校验
                }
                case "STRING" -> {
                    // 字符串类型不需要特殊校验
                }
                case "ARRAY", "OBJECT", "ENUM" -> {
                    // 复杂类型暂时不做校验
                }
                default -> {
                    logger.warn("未知的参数类型: {}", expectedType);
                }
            }
        }
    }

    /**
     * 处理主表变化
     */
    private boolean handleMainTableChange(Map<String, Object> newTableJoinInfo, Map<String, Object> oldTableJoinInfo,
        Long resourceId) {
        String newMainTable = (String) newTableJoinInfo.get("mainTable");
        String oldMainTable = (String) oldTableJoinInfo.get("mainTable");

        if (newMainTable == null || !newMainTable.equals(oldMainTable)) {
            deleteDatasetParamsByResourceId(resourceId);
            return true;
        }
        return false;
    }

    /**
     * 收集需要删除的参数ID
     */
    private void collectAttributesAndDelete(Map<String, Object> newTableJoinInfo, Long resourceId) {
        // 1. 提取新 tableJoinInfo 中的所有字段1 = {SsResExtAttribute@18754}
        Set<String> newFields = extractValidFieldsFromTableJoinInfo(JSON.toJSONString(newTableJoinInfo),
            new HashMap<>());

        // 2. 提取新 tableJoinInfo 中的所有表
        Set<String> newTables = DatasetSqlBuilder.extractTableCodes(newTableJoinInfo);

        // 3. 查询现有的所有参数
        List<SsResExtAttribute> allAttributes = ssResExtAttributeMapper.selectByResourceId(resourceId);
        LambdaQueryWrapper<SsResourceRelDetail> relWrapper = new LambdaQueryWrapper<>();
        relWrapper.eq(SsResourceRelDetail::getResourceId, resourceId);
        relWrapper.select(SsResourceRelDetail::getRelResourceId);
        List<SsResourceRelDetail> ssResourceRelDetails = ssResourceRelDetailMapper.selectList(relWrapper);
        List<Long> relResourceIds = ssResourceRelDetails.stream().map(SsResourceRelDetail::getRelResourceId).toList();
        if (CollectionUtils.isNotEmpty(relResourceIds)) {
            allAttributes.addAll(ssResExtAttributeMapper.selectByResourceIds(relResourceIds));
        }
        // 4. 收集需要删除的参数ID
        List<Long> attributesToDelete = new ArrayList<>();
        for (SsResExtAttribute attribute : allAttributes) {
            @SuppressWarnings("unchecked")
            Map<String, Object> extMeta = JSON.parseObject(attribute.getExtMeta(), Map.class);
            @SuppressWarnings("unchecked")
            Map<String, Object> extMetaMap = JSON.parseObject((String) extMeta.get("extMeta"), Map.class);
            String sourceTableCode = StringUtil.isNotEmpty((String) extMeta.get("sourceTableCode"))
                ? (String) extMeta.get("sourceTableCode")
                : (String) extMetaMap.get("sourceTableCode");

            if (StringUtil.isNotEmpty(sourceTableCode)) {
                String fieldKey = sourceTableCode + ":" + attribute.getAttributeCode();

                // 如果字段不存在或者表不存在，删除
                if (!newFields.contains(fieldKey) || !newTables.contains(sourceTableCode)) {
                    attributesToDelete.add(attribute.getExtAttributeId());
                }
            }
        }

        // 执行批量删除
        performBatchDelete(attributesToDelete);
    }

    /**
     * 执行批量删除
     */
    private void performBatchDelete(List<Long> attributesToDelete) {
        if (!CollectionUtils.isEmpty(attributesToDelete)) {
            LambdaQueryWrapper<SsResExtAttribute> deleteWrapper = new LambdaQueryWrapper<>();
            deleteWrapper.in(SsResExtAttribute::getExtAttributeId, attributesToDelete);
            ssResExtAttributeMapper.delete(deleteWrapper);
        }
    }

}
