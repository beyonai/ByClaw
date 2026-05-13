package com.iwhalecloud.byai.manager.domain.resource.service;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.CollectionUtils;
import com.iwhalecloud.byai.manager.domain.resource.enums.OperationTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;
import com.iwhalecloud.byai.manager.dto.ontology.AttributeUpdateRequest;
import com.iwhalecloud.byai.manager.dto.ontology.ObjectDto;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyActionSaveRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyBatchSaveRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyCreateRelationRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyCreateRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyDeleteRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyDetailResponse;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyUpdateRequest;
import com.iwhalecloud.byai.manager.entity.ontology.SsResExtOntology;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtAttribute;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.ontology.SsResExtOntologyMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtAttributeMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceRelDetailMapper;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.constants.resource.SystemCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.ontology.SourceType;
import com.iwhalecloud.byai.common.constants.resource.ResourceType;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.apache.commons.collections.MapUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/*
 * 对象管理服务
 */
@Service
public class OntologyService {

    public static final Logger logger = LoggerFactory.getLogger(OntologyService.class);

    /**
     * 资源类型常量：原子资源
     */
    private static final String RESOURCE_TYPE_ATOM = "ATOM";

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private OperationLogService operationLogService;

    @Autowired
    private SsResExtOntologyMapper ssResExtOntologyMapper;

    @Autowired
    private SsResourceRelDetailMapper ssResourceRelDetailMapper;

    @Autowired
    private SsResExtAttributeMapper ssResExtAttributeMapper;

    /**
     * 数据来源类型转换为资源类型
     *
     * @param sourceType 数据来源类型：1-API，2-DOCUMENT，3-DB_TABLE
     * @return 资源类型：API、DOCUMENT、DB_TABLE
     */
    public String convertSourceTypeToResourceType(Integer sourceType) {
        if (sourceType == null) {
            throw new BaseException(I18nUtil.get("ontology.source.type.not.null"));
        }
        switch (sourceType) {
            case 1:
                return ResourceType.API;
            case 2:
                return ResourceType.DOCUMENT;
            case 3:
                return ResourceType.DB_TABLE;
            case 4:
                return ResourceType.COMMON_DB;
            default:
                throw new BaseException(I18nUtil.get("ontology.source.type.unsupported", sourceType));
        }
    }

    /**
     * 资源类型转换为数据来源类型
     *
     * @param resourceType 资源类型：API、DOCUMENT、DB_TABLE
     * @return 数据来源类型：1-API，2-DOCUMENT，3-DB_TABLE
     */
    public Integer convertResourceTypeToSourceType(String resourceType) {
        if (StringUtils.isBlank(resourceType)) {
            return null;
        }
        switch (resourceType) {
            case "API":
                return 1;
            case "DOCUMENT":
                return 2;
            case "DB_TABLE":
                return 3;
            default:
                return null;
        }
    }

    /**
     * 创建对象
     *
     * @param request 创建请求
     * @return 创建的资源对象
     */
    public SsResource createOntology(OntologyCreateRequest request) {
        // 参数校验
        validateParam(request.getName(), request.getCatalogId(), request.getSourceType());

        // 检查同名对象是否存在
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResource::getResourceName, request.getName());
        queryWrapper.eq(SsResource::getCreateBy, CurrentUserHolder.getCurrentUserId());
        queryWrapper.eq(SsResource::getResourceBizType, request.getType());
        Long count = ssResourceMapper.selectCount(queryWrapper);
        if (count > 0) {
            throw new BaseException(I18nUtil.get("ontology.object.name.exists"));
        }

        // 创建资源对象
        SsResource resource = new SsResource();
        resource.setResourceId(SequenceService.nextVal());
        resource.setResourceName(request.getName());
        resource.setResourceDesc(request.getDesc());
        resource.setResourceRVerid(0L);
        resource.setResourceDVerid(1L);
        resource.setResourceSourcePkId(request.getDocId());
        resource.setCatalogId(request.getCatalogId());
        resource.setResourceBizType(request.getType());
        resource.setResourceCode(resource.getResourceBizType() + "_" + resource.getResourceId());
        resource.setResourceType(convertSourceTypeToResourceType(request.getSourceType()));
        resource.setSystemCode("BYAI");
        resource.setResourceStatus(0); // 草稿状态

        // 设置创建信息
        OntologyOpenService.setDateUserInfo(resource, ssResourceMapper);
        if (logger.isInfoEnabled()) {
            logger.info("创建对象成功，resourceId={}, resourceName={}", resource.getResourceId(), resource.getResourceName());
        }

        // 写入到本地的扩展表中
        SsResExtOntology ssResExtOntology = new SsResExtOntology();
        ssResExtOntology.setResourceId(resource.getResourceId());
        ssResExtOntology.setPid(request.getPid());
        ssResExtOntologyMapper.insert(ssResExtOntology);

        // 记录操作日志
        operationLogService.recordOperationLog(resource, OperationTypeEnum.CREATE);

        return resource;
    }

    private void validateParam(String name, Long catalogId, Integer sourceType) {
        if (StringUtils.isBlank(name)) {
            throw new BaseException(I18nUtil.get("ontology.object.name.not.null"));
        }
        if (catalogId == null) {
            throw new BaseException(I18nUtil.get("ontology.catalog.id.not.null"));
        }
        if (sourceType == null) {
            throw new BaseException(I18nUtil.get("ontology.source.type.not.null"));
        }
    }

    /**
     * 更新对象
     *
     * @param request 更新请求
     * @return 更新后的资源对象
     */
    public SsResource updateOntology(OntologyUpdateRequest request) {
        // 参数校验
        validateUpdateRequest(request);

        // 验证资源并获取资源对象
        SsResource resource = validateAndGetResource(request.getResourceId());

        // 检查同名对象是否存在
        checkDuplicateName(request);

        // 更新资源对象
        updateResourceFields(resource, request);

        // 保存更新
        ssResourceMapper.updateById(resource);
        if (logger.isInfoEnabled()) {
            logger.info("更新对象成功，resourceId={}, resourceName={}", resource.getResourceId(), resource.getResourceName());
        }
        return resource;
    }

    /**
     * 校验更新请求参数
     *
     * @param request 更新请求
     */
    private void validateUpdateRequest(OntologyUpdateRequest request) {
        if (request.getResourceId() == null) {
            throw new BaseException(I18nUtil.get("ontology.resource.id.not.null"));
        }
        if (StringUtils.isBlank(request.getName())) {
            throw new BaseException(I18nUtil.get("ontology.object.name.not.null"));
        }
    }

    /**
     * 验证资源是否存在并返回资源对象
     *
     * @param resourceId 资源ID
     * @return 资源对象
     */
    private SsResource validateAndGetResource(Long resourceId) {
        SsResource resource = ssResourceMapper.selectById(resourceId);
        if (resource == null) {
            throw new BaseException(I18nUtil.get("ontology.object.not.exist"));
        }
        if (!("OBJECT".equals(resource.getResourceBizType()) || "VIEW".equals(resource.getResourceBizType()))) {
            throw new BaseException(I18nUtil.get("ontology.resource.not.object.view.type"));
        }
        return resource;
    }

    /**
     * 检查同名对象是否存在
     *
     * @param request 更新请求
     */
    private void checkDuplicateName(OntologyUpdateRequest request) {
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResource::getResourceName, request.getName());
        queryWrapper.eq(SsResource::getCreateBy, CurrentUserHolder.getCurrentUserId());
        queryWrapper.eq(SsResource::getResourceBizType, request.getType());
        queryWrapper.ne(SsResource::getResourceId, request.getResourceId());
        Long count = ssResourceMapper.selectCount(queryWrapper);
        if (count > 0) {
            throw new BaseException(I18nUtil.get("ontology.object.view.name.exists"));
        }
    }

    /**
     * 更新资源字段
     *
     * @param resource 资源对象
     * @param request 更新请求
     */
    private void updateResourceFields(SsResource resource, OntologyUpdateRequest request) {
        resource.setResourceName(request.getName());
        if (request.getDesc() != null) {
            resource.setResourceDesc(request.getDesc());
        }
        if (request.getCatalogId() != null) {
            resource.setCatalogId(request.getCatalogId());
        }
        if (request.getSourceType() != null) {
            resource.setResourceType(convertSourceTypeToResourceType(request.getSourceType()));
        }
        if (resource.getResourceCode() != null) {
            resource.setResourceCode(resource.getResourceBizType() + "_" + resource.getResourceId());
        }

        if (request.getDocId() != null) {
            resource.setResourceSourcePkId(request.getDocId());
        }

        resource.setResourceStatus(0);

        // 设置更新信息
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        resource.setUpdateBy(currentUserId);
        resource.setUpdateTime(new Date());
    }

    /**
     * 删除对象
     *
     * @param resourceId 资源ID
     * @return 是否删除成功
     */
    public boolean deleteOntology(Long resourceId) {
        if (resourceId == null) {
            throw new BaseException(I18nUtil.get("ontology.resource.id.not.null"));
        }

        // 查询资源是否存在
        SsResource resource = ssResourceMapper.selectById(resourceId);
        if (resource == null) {
            throw new BaseException(I18nUtil.get("ontology.object.not.exist"));
        }
        if (!"OBJECT".equals(resource.getResourceBizType())) {
            throw new BaseException(I18nUtil.get("ontology.resource.not.object.type"));
        }

        ssResourceMapper.deleteById(resourceId);
        if (logger.isInfoEnabled()) {
            logger.info("删除对象成功，resourceId={}", resourceId);
        }
        return true;
    }

    /**
     * 创建对象关联关系 如果relId为空，则先创建新对象；然后插入双向关联关系
     *
     * @param request 创建关联请求
     * @return 关联的资源对象（如果创建了新对象则返回新对象，否则返回null）
     */
    public SsResource createOntologyRelation(OntologyCreateRelationRequest request) {
        // 参数校验
        if (request.getObjId() == null) {
            throw new BaseException(I18nUtil.get("ontology.related.object.id.not.null"));
        }

        // 校验被关联的对象是否存在
        SsResource objResource = ssResourceMapper.selectById(request.getObjId());
        if (objResource == null) {
            throw new BaseException(I18nUtil.get("ontology.related.object.not.exist"));
        }
        if (!"OBJECT".equals(objResource.getResourceBizType())) {
            throw new BaseException(I18nUtil.get("ontology.related.resource.not.object.type"));
        }

        SsResource newResource = null;
        List<Long> relIds = new ArrayList<>();

        // 如果relId为空，则根据name、desc等参数创建新对象
        if (request.getRelIds() == null || request.getRelIds().isEmpty()) {
            // 校验创建新对象所需的参数
            validateParam(request.getName(), request.getCatalogId(), request.getSourceType());

            // 创建新对象
            OntologyCreateRequest createRequest = new OntologyCreateRequest();
            createRequest.setName(request.getName());
            createRequest.setDesc(request.getDesc());
            createRequest.setCatalogId(request.getCatalogId());
            createRequest.setSourceType(request.getSourceType());
            createRequest.setType(StringUtils.isNotBlank(request.getType()) ? request.getType() : "OBJECT");

            newResource = createOntology(createRequest);
            Long relId = newResource.getResourceId();
            if (logger.isInfoEnabled()) {
                logger.info("创建新对象作为关联对象，newObjId={}, objId={}", relId, request.getObjId());
            }
            relIds.add(relId);

        }
        else {
            relIds = request.getRelIds();
        }

        // 插入双向关联关系
        insertResourceRelDetail(request.getObjId(), relIds);

        return newResource;
    }

    /**
     * 插入资源关联明细数据 在ss_resource_rel_detail表中插入两条数据，实现双向关联
     *
     * @param resourceId 资源ID
     */
    private void insertResourceRelDetail(Long resourceId, List<Long> relIds) {
        if (resourceId == null || relIds.isEmpty()) {
            throw new BaseException(I18nUtil.get("ontology.resource.and.related.id.not.null"));
        }

        // 防止自己关联自己
        if (relIds.contains(resourceId)) {
            throw new BaseException(I18nUtil.get("ontology.cannot.relate.self"));
        }

        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        Long enterpriseId = CurrentUserHolder.getEnterpriseId();
        Date now = new Date();

        List<SsResourceRelDetail> relDetails = new ArrayList<>();
        for (Long relId : relIds) {
            // 创建第一条关联：resourceId -> relResourceId
            SsResourceRelDetail relDetail1 = new SsResourceRelDetail();
            relDetail1.setResourceRelDetailId(SequenceService.nextVal());
            relDetail1.setResourceId(resourceId);
            relDetail1.setRelResourceId(relId);
            relDetail1.setCreateBy(currentUserId);
            relDetail1.setCreateTime(now);
            relDetail1.setUpdateBy(currentUserId);
            relDetail1.setUpdateTime(now);
            if (enterpriseId != null) {
                relDetail1.setComAcctId(enterpriseId);
            }

            // 创建第二条关联：relResourceId -> resourceId（双向关联）
            SsResourceRelDetail relDetail2 = new SsResourceRelDetail();
            relDetail2.setResourceRelDetailId(SequenceService.nextVal());
            relDetail2.setResourceId(relId);
            relDetail2.setRelResourceId(resourceId);
            relDetail2.setCreateBy(currentUserId);
            relDetail2.setCreateTime(now);
            relDetail2.setUpdateBy(currentUserId);
            relDetail2.setUpdateTime(now);
            if (enterpriseId != null) {
                relDetail2.setComAcctId(enterpriseId);
            }
            // 批量插入
            relDetails.add(relDetail1);
            relDetails.add(relDetail2);
        }

        ssResourceRelDetailMapper.insertBatch(relDetails);

    }

    /**
     * 批量更新属性（先删后增） 前端删除操作实质是修改，只需传入删除后的数据列表
     *
     * @param request 更新属性请求
     * @return 更新的属性数量
     */
    public int updateAttributes(AttributeUpdateRequest request) {
        validateUpdateAttributesRequest(request);
        deleteAllAttributesByResourceId(request.getResourceId());

        if (request.getParams() == null || request.getParams().isEmpty()) {
            if (logger.isInfoEnabled()) {
                logger.info("批量更新属性完成，resourceId={}，已删除所有属性", request.getResourceId());
            }
            return 0;
        }

        List<SsResExtAttribute> attributeList = buildAttributesFromRequest(request);
        if (!attributeList.isEmpty()) {
            ssResExtAttributeMapper.insertBatch(attributeList);
            if (logger.isInfoEnabled()) {
                logger.info("批量更新属性成功，resourceId={}, 共新增{}个属性", request.getResourceId(), attributeList.size());
            }
            return attributeList.size();
        }

        if (logger.isInfoEnabled()) {
            logger.info("批量更新属性完成，resourceId={}，已删除所有属性", request.getResourceId());
        }
        return 0;
    }

    /**
     * 校验更新属性请求参数
     */
    private void validateUpdateAttributesRequest(AttributeUpdateRequest request) {
        if (request.getResourceId() == null) {
            throw new BaseException(I18nUtil.get("ontology.resource.id.not.null"));
        }
        SsResource resource = ssResourceMapper.selectById(request.getResourceId());
        if (resource == null) {
            throw new BaseException(I18nUtil.get("ontology.resource.not.exist"));
        }
    }

    /**
     * 删除资源的所有属性
     */
    private void deleteAllAttributesByResourceId(Long resourceId) {
        LambdaQueryWrapper<SsResExtAttribute> deleteWrapper = new LambdaQueryWrapper<>();
        deleteWrapper.eq(SsResExtAttribute::getResourceId, resourceId);
        ssResExtAttributeMapper.delete(deleteWrapper);
        if (logger.isInfoEnabled()) {
            logger.info("删除资源所有属性，resourceId={}", resourceId);
        }
    }

    /**
     * 从请求构建属性列表
     */
    private List<SsResExtAttribute> buildAttributesFromRequest(AttributeUpdateRequest request) {
        List<SsResExtAttribute> attributeList = new ArrayList<>();
        int sortIndex = 1;

        for (AttributeUpdateRequest.FunctionAttribute function : request.getParams()) {
            if (StringUtils.isBlank(function.getFunctionName())) {
                throw new BaseException(I18nUtil.get("ontology.function.name.not.null"));
            }
            if (function.getAttributes() == null || function.getAttributes().isEmpty()) {
                continue;
            }
            sortIndex = buildAttributesForFunction(function, request.getResourceId(), attributeList, sortIndex);
        }

        return attributeList;
    }

    /**
     * 为函数构建属性列表
     */
    private int buildAttributesForFunction(AttributeUpdateRequest.FunctionAttribute function, Long resourceId,
        List<SsResExtAttribute> attributeList, int sortIndex) {
        for (AttributeUpdateRequest.AttributeInfo attrInfo : function.getAttributes()) {
            validateAttributeInfo(attrInfo);
            SsResExtAttribute attribute = createAttributeFromInfo(attrInfo, function.getFunctionName(), resourceId,
                sortIndex++);
            attributeList.add(attribute);
        }
        return sortIndex;
    }

    /**
     * 校验属性信息
     */
    private void validateAttributeInfo(AttributeUpdateRequest.AttributeInfo attrInfo) {
        if (StringUtils.isBlank(attrInfo.getAttributeType())) {
            throw new BaseException(I18nUtil.get("ontology.attribute.type.not.null"));
        }
        if (StringUtils.isBlank(attrInfo.getAttributeCode())) {
            throw new BaseException(I18nUtil.get("ontology.attribute.code.not.null"));
        }
        if (StringUtils.isBlank(attrInfo.getType())) {
            throw new BaseException(I18nUtil.get("ontology.data.type.not.null"));
        }
    }

    /**
     * 从属性信息创建属性对象
     */
    private SsResExtAttribute createAttributeFromInfo(AttributeUpdateRequest.AttributeInfo attrInfo,
        String functionName, Long resourceId, int sort) {
        String fullAttributeCode = functionName + "_" + attrInfo.getAttributeCode();
        SsResExtAttribute attribute = new SsResExtAttribute();
        attribute.setExtAttributeId(SequenceService.nextVal());
        attribute.setResourceId(resourceId);
        attribute.setAttributeType(attrInfo.getAttributeType());
        attribute.setAttributeCode(fullAttributeCode);
        attribute.setAttributeValue(attrInfo.getAttributeValue());
        attribute.setType(attrInfo.getType());
        attribute.setFormatExpSt(attrInfo.getFormatExpSt());
        attribute.setUnit(attrInfo.getUnit());
        attribute.setIsRequired(attrInfo.getIsRequired() != null ? attrInfo.getIsRequired() : 0);
        attribute.setTermTypeCode(attrInfo.getTermTypeCode());
        attribute.setTermField(attrInfo.getTermField());
        attribute.setAttributeDesc(attrInfo.getAttributeDesc());
        attribute.setExtMeta(attrInfo.getExtMeta());
        attribute.setSort(attrInfo.getSort() != null ? attrInfo.getSort() : sort);
        return attribute;
    }

    /**
     * 保存对象的函数和属性相关内容 包括：对象基本信息、对象属性、函数和函数属性、关联对象
     *
     * @param request 函数和属性保存请求
     * @return 保存结果
     */
    public Map<String, Object> saveOntologyAttributes(OntologyActionSaveRequest request) {

        // 遍历所有对象

        if (request.getResourceId() == null) {
            throw new BaseException(I18nUtil.get("ontology.resource.id.not.null"));
        }

        Map<String, Object> savedObj = new HashMap<>();
        Long resourceId = request.getResourceId();

        // 1. 更新对象基本信息--不考虑更新基本信息
        // processObjectBasicInfo(request, resourceId, savedObj);

        // 2. 处理对象属性
        processObjectAttributes(request, resourceId, savedObj);

        return savedObj;
    }

    /**
     * 处理对象基本信息更新（用于saveBatchForOther等需要同时更新基本信息的场景）
     */
    public void processObjectBasicInfo(OntologyActionSaveRequest objRequest, Long resourceId,
        Map<String, Object> savedObj) {
        if (StringUtils.isNotBlank(objRequest.getName()) || objRequest.getCatalogId() != null
            || objRequest.getSourceType() != null || StringUtils.isNotBlank(objRequest.getDesc())) {
            OntologyUpdateRequest updateRequest = new OntologyUpdateRequest();
            updateRequest.setResourceId(resourceId);
            updateRequest.setName(objRequest.getName());
            updateRequest.setDesc(objRequest.getDesc());
            updateRequest.setCatalogId(objRequest.getCatalogId());
            updateRequest.setSourceType(objRequest.getSourceType());
            SsResource updatedResource = updateOntology(updateRequest);
            savedObj.put("object", updatedResource);
        }
    }

    /**
     * 处理对象属性（用于函数保存） 前端传入完整属性列表，后端根据extAttributeId自动对比数据库计算增删改
     */
    public void processObjectAttributes(OntologyActionSaveRequest objRequest, Long resourceId,
        Map<String, Object> savedObj) {
        if (objRequest.getAttributes() == null || objRequest.getAttributes().isEmpty()) {
            // 如果前端没有传属性，说明要清空所有属性
            LambdaQueryWrapper<SsResExtAttribute> queryWrapper = new LambdaQueryWrapper<>();
            queryWrapper.eq(SsResExtAttribute::getResourceId, resourceId);
            ssResExtAttributeMapper.delete(queryWrapper);

            savedObj.put("attributesList", null);
            return;
        }

        // 1. 从数据库查询现有的对象属性
        Map<Long, SsResExtAttribute> existingAttrMap = getExistAttr(resourceId);

        // 3. 遍历前端传入的属性，判断是新增还是更新
        List<OntologyBatchSaveRequest.ObjectAttribute> addList = new ArrayList<>();
        List<OntologyBatchSaveRequest.ObjectAttribute> updateList = new ArrayList<>();
        for (OntologyBatchSaveRequest.ObjectAttribute attr : objRequest.getAttributes()) {

            dealAddOrUpdate(attr, existingAttrMap, addList, updateList);
        }

        // 4. 计算需要删除的属性（数据库中存在但前端没有传入的）
        List<Long> deleteList = calculateDeleteList(objRequest, existingAttrMap);

        // 5. 执行增删改操作（批量）
        List<SsResExtAttribute> savedAttributesList = dealADMQ(deleteList, addList, updateList, resourceId);

        savedObj.put("attributesList", savedAttributesList);

    }

    public List<SsResExtAttribute> dealADMQ(List<Long> deleteList,
        List<OntologyBatchSaveRequest.ObjectAttribute> addList,
        List<OntologyBatchSaveRequest.ObjectAttribute> updateList, Long resourceId) {

        int deleteCount = batchDeleteObjectAttributes(deleteList, resourceId);
        List<SsResExtAttribute> savedAddList = batchAddObjectAttributes(addList, resourceId);
        List<SsResExtAttribute> savedUpdateList = batchUpdateObjectAttributes(updateList, resourceId);

        // 合并新增和更新的列表
        List<SsResExtAttribute> savedAttributesList = new ArrayList<>();
        savedAttributesList.addAll(savedAddList);
        savedAttributesList.addAll(savedUpdateList);

        if (logger.isInfoEnabled()) {
            logger.info("对象属性处理完成，resourceId={}, 新增={}, 修改={}, 删除={}, 总计={}", resourceId, savedAddList.size(),
                savedUpdateList.size(), deleteCount, savedAddList.size() + savedUpdateList.size());
        }

        return savedAttributesList;
    }

    private static List<Long> calculateDeleteList(OntologyActionSaveRequest objRequest,
        Map<Long, SsResExtAttribute> existingAttrMap) {
        List<Long> deleteList = new ArrayList<>();
        Set<Long> frontendAttrIds = new HashSet<>();
        for (OntologyBatchSaveRequest.ObjectAttribute attr : objRequest.getAttributes()) {
            if (attr.getExtAttributeId() != null) {
                frontendAttrIds.add(attr.getExtAttributeId());
            }
        }

        for (Map.Entry<Long, SsResExtAttribute> entry : existingAttrMap.entrySet()) {
            Long attrId = entry.getKey();
            if (!frontendAttrIds.contains(attrId)) {
                // 数据库有但前端没有传入，按删除处理
                deleteList.add(attrId);
            }
        }
        return deleteList;
    }

    private void dealAddOrUpdate(OntologyBatchSaveRequest.ObjectAttribute attr,
        Map<Long, SsResExtAttribute> existingAttrMap, List<OntologyBatchSaveRequest.ObjectAttribute> addList,
        List<OntologyBatchSaveRequest.ObjectAttribute> updateList) {
        if (attr.getExtAttributeId() == null) {
            // 没有ID，肯定是新增
            addList.add(attr);
        }
        else {
            // 有ID，需要判断是新增还是更新
            if (existingAttrMap.containsKey(attr.getExtAttributeId())) {
                // ID在数据库中存在，按更新处理
                updateList.add(attr);
            }
            else {
                // ID不在数据库中，按新增处理
                addList.add(attr);
            }
        }
    }

    private Map<Long, SsResExtAttribute> getExistAttr(Long resourceId) {
        LambdaQueryWrapper<SsResExtAttribute> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResExtAttribute::getResourceId, resourceId);
        List<SsResExtAttribute> existingAttrs = ssResExtAttributeMapper.selectList(queryWrapper);

        // 2. 构建对比Map：key为属性ID（extAttributeId），value为数据库实体
        Map<Long, SsResExtAttribute> existingAttrMap = new HashMap<>();
        for (SsResExtAttribute existingAttr : existingAttrs) {
            existingAttrMap.put(existingAttr.getExtAttributeId(), existingAttr);
        }
        return existingAttrMap;
    }

    /**
     * 批量删除对象属性
     */
    private int batchDeleteObjectAttributes(List<Long> deleteList, Long resourceId) {
        if (deleteList == null || deleteList.isEmpty()) {
            return 0;
        }
        ssResExtAttributeMapper.deleteBatchIds(deleteList);
        if (logger.isInfoEnabled()) {
            logger.info("批量删除对象属性，resourceId={}, 删除数量={}", resourceId, deleteList.size());
        }
        return deleteList.size();
    }

    /**
     * 批量新增对象属性
     */
    private List<SsResExtAttribute> batchAddObjectAttributes(List<OntologyBatchSaveRequest.ObjectAttribute> addList,
        Long resourceId) {
        if (addList == null || addList.isEmpty()) {
            return new ArrayList<>();
        }

        List<SsResExtAttribute> addAttributeList = appendIdAndExtMeta(addList, resourceId);

        if (!addAttributeList.isEmpty()) {
            ssResExtAttributeMapper.insertBatch(addAttributeList);
        }

        if (logger.isInfoEnabled()) {
            logger.info("批量新增对象属性，resourceId={}, 新增数量={}", resourceId, addAttributeList.size());
        }
        return addAttributeList;
    }

    private void setExtMeta(SsResExtAttribute attribute, OntologyBatchSaveRequest.ObjectAttribute attr) {
        Map<String, Object> extMeta = new HashMap<>();
        // 设置业务主键
        setBusinessInfo(extMeta, attr);

        // 设置关联的插件，工具以及工具的路径，函数的名字
        setRelToolInfo(extMeta, attr);

        // 设置权限信息
        setPrivInfo(extMeta, attr);

        // 设置术语信息
        setTermInfo(extMeta, attr);

        attribute.setExtMeta(JSON.toJSONString(extMeta));
    }

    private void setPrivInfo(Map<String, Object> extMeta, OntologyBatchSaveRequest.ObjectAttribute attr) {
        if (attr.getPerDataScopeType() != null) {
            extMeta.put("perDataScopeType", attr.getPerDataScopeType());
        }
    }

    private void setTermInfo(Map<String, Object> extMeta, OntologyBatchSaveRequest.ObjectAttribute attr) {
        if (attr.getTermDataType() != null) {
            extMeta.put("termDataType", attr.getTermDataType());
        }
        if (attr.getDatasetId() != null) {
            extMeta.put("datasetId", attr.getDatasetId());
        }
        if (attr.getTermTypeName() != null) {
            extMeta.put("termTypeName", attr.getTermTypeName());
        }
    }

    /**
     * 设置关联的函数信息
     *
     * @param extMeta
     * @param attr
     */
    private void setRelToolInfo(Map<String, Object> extMeta, OntologyBatchSaveRequest.ObjectAttribute attr) {
        List<Map<String, Object>> relInfos = new ArrayList<>();
        if (attr.getRelInfos() != null) {
            for (OntologyBatchSaveRequest.FunctionInfo relInfo : attr.getRelInfos()) {
                relInfos.add(MapParamUtil.objectToMap(relInfo));
            }
        }
        extMeta.put("relInfos", relInfos);
    }

    private void setBusinessInfo(Map<String, Object> extMeta, OntologyBatchSaveRequest.ObjectAttribute attr) {
        if (attr.getIsBizId() != null) {
            extMeta.put("isBizId", attr.getIsBizId());
        }
        if (attr.getIsBizLabel() != null) {
            extMeta.put("isBizLabel", attr.getIsBizLabel());
        }
        if (attr.getIsQueryAttr() != null) {
            extMeta.put("isQueryAttr", attr.getIsQueryAttr());
        }
    }

    /**
     * 批量更新对象属性
     */
    private List<SsResExtAttribute> batchUpdateObjectAttributes(
        List<OntologyBatchSaveRequest.ObjectAttribute> updateList, Long resourceId) {

        if (updateList == null || updateList.isEmpty()) {
            return new ArrayList<>();
        }
        List<SsResExtAttribute> updateAttributeList = appendIdAndExtMeta(updateList, resourceId);

        if (!updateAttributeList.isEmpty()) {
            ssResExtAttributeMapper.updateBatch(updateAttributeList);
        }

        if (logger.isInfoEnabled()) {
            logger.info("批量更新对象属性，resourceId={}, 更新数量={}", resourceId, updateAttributeList.size());
        }
        return updateAttributeList;
    }

    private List<SsResExtAttribute> appendIdAndExtMeta(List<OntologyBatchSaveRequest.ObjectAttribute> updateList,
        Long resourceId) {

        List<SsResExtAttribute> updateAttributeList = new ArrayList<>();

        for (OntologyBatchSaveRequest.ObjectAttribute attr : updateList) {
            SsResExtAttribute attribute = new SsResExtAttribute();
            BeanUtils.copyProperties(attr, attribute);
            attribute.setResourceId(resourceId);
            if (attr.getExtAttributeId() == null) {
                attribute.setExtAttributeId(SequenceService.nextVal());
            }
            setExtMeta(attribute, attr);
            updateAttributeList.add(attribute);

        }
        return updateAttributeList;
    }

    /**
     * 保存对象的动作相关内容 包括：动作和动作属性
     *
     * @param request 动作保存请求
     * @return 保存结果
     */
    public List<OntologyBatchSaveRequest.ActionInfo> saveOntologyActions(OntologyActionSaveRequest request) {
        if (request.getResourceId() == null) {
            throw new BaseException(I18nUtil.get("ontology.object.resource.id.not.null"));
        }
        if (request.getActions() == null || request.getActions().isEmpty()) {
            return null;
        }

        Long resourceId = request.getResourceId();

        // 校验动作编码和名称的唯一性
        validateActionCodeAndNameUniqueness(request.getActions());

        // 处理动作和动作属性
        List<OntologyBatchSaveRequest.ActionInfo> actionInfos = processActionsForAction(request.getActions(),
            resourceId);

        if (logger.isInfoEnabled()) {
            logger.info("保存对象动作成功，resourceId={}", resourceId);
        }
        return actionInfos;
    }

    /**
     * 校验动作编码和名称的唯一性 确保请求内的动作编码和名称都不重复 注意：请求里的actions最后就会变成对象关联的动作，所以只需要判断请求内的动作编码和名称不能重复即可
     *
     * @param actions 动作列表
     */
    private void validateActionCodeAndNameUniqueness(List<OntologyBatchSaveRequest.ActionInfo> actions) {
        if (actions == null || actions.isEmpty()) {
            return;
        }

        // 校验请求内的动作编码和名称不能重复
        Set<String> codeSet = new HashSet<>();
        Set<String> nameSet = new HashSet<>();

        for (OntologyBatchSaveRequest.ActionInfo actionInfo : actions) {
            // 校验编码不能为空
            if (StringUtils.isBlank(actionInfo.getCode())) {
                throw new BaseException(I18nUtil.get("ontology.action.code.notnull"));
            }

            // 校验名称不能为空
            if (StringUtils.isBlank(actionInfo.getName())) {
                throw new BaseException(I18nUtil.get("ontology.action.name.notnull"));
            }

            // 校验编码在请求中不能重复
            if (codeSet.contains(actionInfo.getCode())) {
                throw new BaseException(
                    I18nUtil.get("ontology.action.code.duplicate.in.request", actionInfo.getCode()));
            }
            codeSet.add(actionInfo.getCode());

            // 校验名称在请求中不能重复
            if (nameSet.contains(actionInfo.getName())) {
                throw new BaseException(
                    I18nUtil.get("ontology.action.name.duplicate.in.request", actionInfo.getName()));
            }
            nameSet.add(actionInfo.getName());
        }
    }

    /**
     * 处理动作和动作属性（用于动作保存） 批量创建/更新动作资源，处理动作属性，建立关联关系
     */
    private List<OntologyBatchSaveRequest.ActionInfo> processActionsForAction(
        List<OntologyBatchSaveRequest.ActionInfo> actions, Long resourceId) {
        if (actions == null || actions.isEmpty()) {
            return null;
        }

        // 1. 批量创建或更新动作资源并处理属性
        List<OntologyBatchSaveRequest.ActionInfo> allActions = batchCreateOrUpdateActionResources(actions, resourceId);

        // 2. 建立对象和动作的关联关系,以及动作和工具工具集的
        batchCreateActionRelations(resourceId, allActions);

        return allActions;
    }

    /**
     * 批量创建或更新动作资源并处理属性 返回 Map<ActionInfo, resourceId>，用于后续建立关联关系
     *
     * @param actions 动作列表
     * @param resourceId 对象资源ID
     * @return Map<ActionInfo, resourceId>
     */
    private List<OntologyBatchSaveRequest.ActionInfo> batchCreateOrUpdateActionResources(
        List<OntologyBatchSaveRequest.ActionInfo> actions, Long resourceId) {

        // 设置用户和时间信息
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        Date now = new Date();
        Long enterpriseId = CurrentUserHolder.getEnterpriseId();

        // 1. 分类收集需要新增和更新的动作
        List<OntologyBatchSaveRequest.ActionInfo> addActions = new ArrayList<>();
        List<OntologyBatchSaveRequest.ActionInfo> updateActions = new ArrayList<>();

        // 查询已有的关联动作
        List<SsResourceDTO> ssResourceDTOS = ssResourceMapper.selectRelResourceListByType(List.of(resourceId),
            ResourceBizType.ACTION.getCode());
        Set<Long> existingActionIds = new HashSet<>();

        for (OntologyBatchSaveRequest.ActionInfo actionInfo : actions) {
            if (actionInfo.getResourceId() != null) {
                updateActions.add(actionInfo);
                existingActionIds.add(actionInfo.getResourceId());
            }
            else {
                addActions.add(actionInfo);
            }
        }

        // 2. 得到要删除的动作（对象引用的动作不存在于修改的列表中）
        List<Long> deleteIds = ssResourceDTOS.stream()
            .filter(rel -> !existingActionIds.contains(rel.getRelResourceId())).map(SsResourceDTO::getRelResourceId)
            .collect(Collectors.toList());

        // 3. 找到存在的动作进行批量修改
        Map<Long, SsResource> existingResourceMap = new HashMap<>();
        if (!existingActionIds.isEmpty()) {
            LambdaQueryWrapper<SsResource> query1 = new LambdaQueryWrapper<>();
            query1.in(SsResource::getResourceId, existingActionIds);
            List<SsResource> existingResourceList = ssResourceMapper.selectList(query1);
            existingResourceMap = existingResourceList.stream().filter(item -> item.getResourceId() != null)
                .collect(Collectors.toMap(SsResource::getResourceId, resource -> resource));
        }

        // 4. 删除不再需要的动作资源
        if (!deleteIds.isEmpty()) {
            batchDeleteActionResources(deleteIds);
        }

        List<OntologyBatchSaveRequest.ActionInfo> allActions = new ArrayList<>();

        // 6. 批量更新动作资源并处理属性
        if (!updateActions.isEmpty()) {
            batchUpdateActionResources(updateActions, currentUserId, now, existingResourceMap, resourceId);
            allActions.addAll(updateActions);
        }

        if (!addActions.isEmpty()) {
            batchInsertActionResources(addActions, currentUserId, now, enterpriseId, resourceId);
            allActions.addAll(addActions);
        }

        return allActions;
    }

    /**
     * 批量删除动作资源 包括：删除关联关系、删除资源本身
     */
    private void batchDeleteActionResources(List<Long> deleteIds) {
        if (deleteIds == null || deleteIds.isEmpty()) {
            return;
        }

        // 1. 从ss_resource_rel_detail表删除关联关系（根据rel_resource_id删除）
        LambdaQueryWrapper<SsResourceRelDetail> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.in(SsResourceRelDetail::getRelResourceId, deleteIds);
        ssResourceRelDetailMapper.delete(queryWrapper);

        // 2. 从ss_resource表中删除资源
        ssResourceMapper.deleteBatchIds(deleteIds);

        // 3. 删除动作在ss_res_ext_attribute表中的数据
        ssResExtAttributeMapper.deleteBatchIds(deleteIds);

        if (logger.isInfoEnabled()) {
            logger.info("批量删除动作资源成功，删除数量={}", deleteIds.size());
        }
    }

    /**
     * 批量新增动作资源并处理属性 对于新增的动作，属性直接插入（因为是全新的，无需对比）
     *
     * @return Map<ActionInfo, resourceId>
     */
    private void batchInsertActionResources(List<OntologyBatchSaveRequest.ActionInfo> addActions, Long currentUserId,
        Date now, Long enterpriseId, Long objResourceId) {

        List<SsResource> addResourceList = new ArrayList<>();

        // 1. 批量处理新增的动作
        batchAddActions(addResourceList, addActions, currentUserId, now, enterpriseId);

        if (logger.isInfoEnabled()) {
            logger.info("批量新增动作资源成功，新增数量={}", addResourceList.size());
        }

        // 2. 批量处理新增动作的属性（直接插入，无需对比）
        batchAddActionAttributesDirectly(addActions, objResourceId);

    }

    private void batchAddActions(List<SsResource> addResourceList, List<OntologyBatchSaveRequest.ActionInfo> addActions,
        Long currentUserId, Date now, Long enterpriseId) {

        List<String> codes = new ArrayList<>();
        // 1. 创建动作资源
        for (OntologyBatchSaveRequest.ActionInfo actionInfo : addActions) {
            SsResource actionResource = new SsResource();
            Long newResourceId = SequenceService.nextVal();
            actionResource.setResourceId(newResourceId);
            actionResource.setResourceName(actionInfo.getName());
            actionResource.setResourceCode(actionInfo.getCode());
            actionResource.setResourceDesc(actionInfo.getDesc());
            actionResource.setResourceBizType("ACTION");
            actionResource.setResourceType("ATOM");
            actionResource.setSystemCode("BYAI");
            actionResource.setResourceStatus(2);

            actionResource.setCreateBy(currentUserId);
            actionResource.setCreateTime(now);
            actionResource.setUpdateBy(currentUserId);
            actionResource.setUpdateTime(now);
            actionResource.setComAcctId(currentUserId);

            if (codes.contains(actionInfo.getCode())) {
                throw new BaseException(I18nUtil.get("ontology.action.code.duplicate.in.batch", actionInfo.getName(),
                    actionInfo.getCode()));
            }
            codes.add(actionInfo.getCode());

            if (enterpriseId != null) {
                actionResource.setComAcctId(enterpriseId);
            }

            addResourceList.add(actionResource);

            // 更新 actionInfo 的 resourceId，以便后续使用
            actionInfo.setResourceId(newResourceId);
        }

        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.in(SsResource::getResourceCode, codes);
        queryWrapper.eq(SsResource::getCreateBy, currentUserId);
        queryWrapper.eq(SsResource::getResourceBizType, ResourceBizType.ACTION.getCode());
        List<SsResource> existingResources = ssResourceMapper.selectList(queryWrapper);
        if (!existingResources.isEmpty()) {
            List<String> codeList = existingResources.stream().filter(item -> item.getResourceCode() != null)
                .map(SsResource::getResourceCode).toList();
            String codeStr = String.join(",", codeList);
            throw new BaseException(I18nUtil.get("ontology.action.code.exists", codeStr));
        }

        // 2. 批量插入动作资源
        if (!addResourceList.isEmpty()) {
            ssResourceMapper.insertBatch(addResourceList);
        }
    }

    /**
     * 批量新增动作属性（用于新增的动作，无需对比数据库） 一次性收集所有新增动作的属性，然后批量插入
     */
    private void batchAddActionAttributesDirectly(List<OntologyBatchSaveRequest.ActionInfo> addActions,
        Long objResourceId) {

        // 收集所有需要新增的属性
        List<SsResExtAttribute> allAddAttributeList = new ArrayList<>();

        for (OntologyBatchSaveRequest.ActionInfo actionInfo : addActions) {
            if (actionInfo.getAttributes() == null || actionInfo.getAttributes().isEmpty()) {
                continue;
            }

            Long actionResourceId = actionInfo.getResourceId();
            if (actionResourceId == null) {
                continue;
            }

            for (OntologyBatchSaveRequest.ActionAttribute attr : actionInfo.getAttributes()) {
                SsResExtAttribute attribute = createActionAttributeFromInfo(attr, actionResourceId, actionInfo);
                allAddAttributeList.add(attribute);
            }
        }

        // 批量插入所有属性
        if (!allAddAttributeList.isEmpty()) {
            ssResExtAttributeMapper.insertBatch(allAddAttributeList);
            if (logger.isInfoEnabled()) {
                logger.info("批量新增动作属性成功，objId={}, 新增数量={}", objResourceId, allAddAttributeList.size());
            }
        }
    }

    /**
     * 批量更新动作资源并处理属性 对于修改的动作，属性需要按照增删改逻辑处理
     */
    private void batchUpdateActionResources(List<OntologyBatchSaveRequest.ActionInfo> updateActions, Long currentUserId,
        Date now, Map<Long, SsResource> existingResourceMap, Long objResourceId) {
        List<SsResource> updateResourceList = new ArrayList<>();

        // 1. 更新动作资源基本信息
        for (OntologyBatchSaveRequest.ActionInfo actionInfo : updateActions) {
            SsResource existingResource = existingResourceMap.get(actionInfo.getResourceId());
            if (existingResource != null) {
                existingResource.setResourceName(actionInfo.getName());
                existingResource.setResourceCode(actionInfo.getCode());
                existingResource.setResourceDesc(actionInfo.getDesc());
                existingResource.setResourceStatus(ResourceStatus.LIST.getNum());
                existingResource.setUpdateBy(currentUserId);
                existingResource.setUpdateTime(now);
                updateResourceList.add(existingResource);
            }
            else {
                if (logger.isInfoEnabled()) {
                    logger.info("警告：动作资源不存在，resourceId={}", actionInfo.getResourceId());
                }
            }
        }

        // 2. 批量更新动作资源
        for (SsResource resource : updateResourceList) {
            ssResourceMapper.updateById(resource);
        }

        if (logger.isInfoEnabled()) {
            logger.info("批量更新动作资源成功，更新数量={}", updateResourceList.size());
        }

        // 3. 收集所有修改动作的属性增删改列表
        List<ActionAttributeOperationLists> allOperationLists = new ArrayList<>();
        for (OntologyBatchSaveRequest.ActionInfo actionInfo : updateActions) {
            if (actionInfo.getResourceId() != null) {
                ActionAttributeOperationLists operationLists = processActionAttributes(actionInfo,
                    actionInfo.getResourceId(), objResourceId);
                allOperationLists.add(operationLists);
            }
        }

        // 4. 统一批量执行所有动作的增删改操作
        batchExecuteActionAttributeOperations(allOperationLists);
    }

    /**
     * 批量执行所有动作的属性增删改操作
     */
    private void batchExecuteActionAttributeOperations(List<ActionAttributeOperationLists> allOperationLists) {
        // 收集所有需要删除的属性ID
        List<Long> allDeleteList = new ArrayList<>();
        for (ActionAttributeOperationLists operationLists : allOperationLists) {
            allDeleteList.addAll(operationLists.getDeleteList());
        }

        // 收集所有需要新增的属性
        List<SsResExtAttribute> allAddList = new ArrayList<>();
        for (ActionAttributeOperationLists operationLists : allOperationLists) {
            for (ActionAttributeWithResourceId item : operationLists.getAddList()) {
                SsResExtAttribute attribute = createActionAttributeFromInfo(item.attribute, item.actionResourceId,
                    item.actionInfo);
                allAddList.add(attribute);
            }
        }

        // 收集所有需要更新的属性
        List<SsResExtAttribute> allUpdateList = new ArrayList<>();
        for (ActionAttributeOperationLists operationLists : allOperationLists) {
            for (ActionAttributeWithResourceId item : operationLists.getUpdateList()) {
                SsResExtAttribute attribute = createActionAttributeFromInfo(item.attribute, item.actionResourceId,
                    item.actionInfo);

                allUpdateList.add(attribute);
            }
        }

        // 批量执行删除
        if (!allDeleteList.isEmpty()) {
            ssResExtAttributeMapper.deleteBatchIds(allDeleteList);
            if (logger.isInfoEnabled()) {
                logger.info("批量删除动作属性，删除数量={}", allDeleteList.size());
            }
        }

        // 批量执行新增
        if (!allAddList.isEmpty()) {
            ssResExtAttributeMapper.insertBatch(allAddList);
            if (logger.isInfoEnabled()) {
                logger.info("批量新增动作属性，新增数量={}", allAddList.size());
            }
        }

        // 批量执行更新
        if (!allUpdateList.isEmpty()) {
            ssResExtAttributeMapper.updateBatch(allUpdateList);
            if (logger.isInfoEnabled()) {
                logger.info("批量更新动作属性，更新数量={}", allUpdateList.size());
            }
        }
    }

    public Map<String, Object> saveOntologyInfos(OntologyActionSaveRequest request) {

        // 更新对象的基本信息和 属性的信息（增删改）
        Map<String, Object> resultMap = saveOntologyAttributes(request);

        // 保存对象的动作及动作的属性数据、动作的关联数据
        List<OntologyBatchSaveRequest.ActionInfo> actionInfos = saveOntologyActions(request);

        SsResource resource = ssResourceMapper.selectById(request.getResourceId());
        // 创建虚拟动作
        createVirtualActions(resource.getResourceId(), resource.getResourceName(), request.getSourceType());

        resultMap.put("actionInfos", actionInfos);

        return resultMap;
    }

    public void createVirtualActions(@NotNull Long resourceId, String name, Integer sourceType) {
        SsResource resource = ssResourceMapper.selectById(resourceId);
        if (sourceType != null
            && (Objects.equals(sourceType, SourceType.DOCUMENT) || Objects.equals(sourceType, SourceType.COMMON_DB))) {
            // 如果没有对应的actions，才创建
            List<SsResourceDTO> ssResourceDTOS = ssResourceMapper.selectRelResourceListByType(List.of(resourceId),
                ResourceBizType.ACTION.getCode());
            if (CollectionUtils.isNotEmpty(ssResourceDTOS)) {
                return;
            }
            List<SsResource> resourceList = new ArrayList<>();

            if (Objects.equals(sourceType, SourceType.DOCUMENT)) {
                createDocVirtualActions(resourceId, resource.getResourceName(), resourceList);
            }
            if (Objects.equals(sourceType, SourceType.COMMON_DB)) {
                createCommonDbVirtualActions(resourceId, resource.getResourceName(), resourceList);
            }
            // 插入actions
            if (!resourceList.isEmpty()) {
                ssResourceMapper.insertBatch(resourceList);
                // 增加关联关系
                addRelInfo(resourceList, resourceId);
            }

        }
    }

    private void addRelInfo(List<SsResource> resourceList, Long resourceId) {
        List<SsResourceRelDetail> rels = new ArrayList<>();
        for (SsResource resource : resourceList) {
            SsResourceRelDetail detail = new SsResourceRelDetail();
            detail.setResourceId(resourceId);
            detail.setRelResourceId(resource.getResourceId());
            detail.setResourceRelDetailId(SequenceService.nextVal());
            Date date = new Date();
            detail.setCreateTime(date);
            detail.setUpdateTime(date);
            Long currentUserId = CurrentUserHolder.getCurrentUserId();
            detail.setCreateBy(currentUserId);
            detail.setCreateBy(currentUserId);
            rels.add(detail);
        }
        ssResourceRelDetailMapper.insertBatch(rels);
    }

    /**
     * 创建文档虚拟动作 为文档资源创建查询相关的虚拟动作
     *
     * @param resourceId 对象资源ID
     * @param name
     * @param resourceList
     */
    private void createDocVirtualActions(@NotNull(message = "对象资源ID不能为空") Long resourceId, String name,
        List<SsResource> resourceList) {

        String docQuery = "DOC_S_ACTION" + "_" + resourceId;
        String chunck = "CHUNCK_S_ACTION" + "_" + resourceId;
        String docName = name + "附件查询";
        String chunckName = name + "内容查询";
        // 1. 文档附件查询
        createAction(docName, docQuery, RESOURCE_TYPE_ATOM, docName, resourceList);
        // 2. 文档内容查询
        createAction(chunckName, chunck, RESOURCE_TYPE_ATOM, chunckName, resourceList);
    }

    /**
     * 创建通用数据库虚拟动作 为数据库对象资源创建增删改查相关的虚拟动作
     *
     * @param resourceId 对象资源ID
     * @param resourceName
     * @param resourceList
     */
    private void createCommonDbVirtualActions(@NotNull(message = "对象资源ID不能为空") Long resourceId, String resourceName,
        List<SsResource> resourceList) {

        String query = "查询[" + resourceName + "]对象数据";
        String modify = "修改[" + resourceName + "]对象数据";
        String delete = "删除[" + resourceName + "]对象数据";
        String add = "新增[" + resourceName + "]对象数据";
        String queryDesc = "查询" + resourceName + "对象数据";
        String modifyDesc = "修改" + resourceName + "对象数据";
        String deleteDesc = "删除" + resourceName + "对象数据";
        String addDesc = "新增" + resourceName + "对象数据";

        // 1. 查询动作
        createAction(query, "QUERY" + resourceId, RESOURCE_TYPE_ATOM, queryDesc, resourceList);
        // 2. 修改动作
        createAction(modify, "MODIFY" + resourceId, RESOURCE_TYPE_ATOM, modifyDesc, resourceList);
        // 3. 新增动作
        createAction(add, "ADD" + resourceId, RESOURCE_TYPE_ATOM, addDesc, resourceList);
        // 4. 删除动作
        createAction(delete, "DELETE" + resourceId, RESOURCE_TYPE_ATOM, deleteDesc, resourceList);
    }

    /**
     * 创建动作资源 在resourceList中创建一个新的动作资源对象
     *
     * @param resourceName 资源名称
     * @param resourceCode 资源编码
     * @param resourceType 资源类型（ATOM或COMBIN）
     * @param resourceDesc 资源描述
     * @param resourceList 资源列表（输出参数，创建的资源会被添加到该列表）
     */
    private void createAction(String resourceName, String resourceCode, String resourceType, String resourceDesc,
        List<SsResource> resourceList) {
        if (resourceList == null) {
            if (logger.isInfoEnabled()) {
                logger.info("resourceList为空，无法创建动作资源");
            }
            return;
        }

        // 获取当前用户ID和时间
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        Date now = new Date();

        // 创建资源对象
        SsResource resource = new SsResource();
        resource.setResourceId(SequenceService.nextVal());
        resource.setResourceName(resourceName);
        resource.setResourceStatus(ResourceStatus.LIST.getNum());
        resource.setSystemCode(SystemCode.BYAI.getCode());
        resource.setResourceCode(resourceCode);
        resource.setComAcctId(CurrentUserHolder.getEnterpriseId());
        resource.setResourceType(resourceType);
        resource.setResourceBizType(Constants.ResourceBizType.ACTION);
        resource.setResourceDesc(resourceDesc);
        resource.setCreateBy(currentUserId);
        resource.setCreateTime(now);
        resource.setUpdateBy(currentUserId);
        resource.setUpdateTime(now);

        // 添加到资源列表
        resourceList.add(resource);
    }

    /**
     * 批量创建动作关联关系
     */
    private void batchCreateActionRelations(Long objResourceId, List<OntologyBatchSaveRequest.ActionInfo> actionInfos) {
        if (actionInfos == null || actionInfos.isEmpty()) {
            return;
        }

        List<SsResourceRelDetail> relDetails = new ArrayList<>();
        List<Long> actionIds = new ArrayList<>();
        // 创建新的关联关系
        for (OntologyBatchSaveRequest.ActionInfo actionInfo : actionInfos) {
            actionIds.add(actionInfo.getResourceId());
            // 1.对象和动作
            SsResourceRelDetail relDetail = new SsResourceRelDetail();
            relDetail.setResourceRelDetailId(SequenceService.nextVal());
            relDetail.setResourceId(objResourceId);
            relDetail.setRelResourceId(actionInfo.getResourceId());
            relDetails.add(relDetail);

            // 2.动作和对象
            SsResourceRelDetail relObjectDetail = new SsResourceRelDetail();
            relObjectDetail.setResourceRelDetailId(SequenceService.nextVal());
            relObjectDetail.setResourceId(actionInfo.getResourceId());
            relObjectDetail.setRelResourceId(objResourceId);
            relDetails.add(relObjectDetail);

            if (null != actionInfo.getToolId()) {
                // 3.动作和工具集
                SsResourceRelDetail relToolDetail = new SsResourceRelDetail();
                relToolDetail.setResourceId(actionInfo.getResourceId());
                relToolDetail.setResourceRelDetailId(SequenceService.nextVal());
                relToolDetail.setRelResourceId(actionInfo.getToolId());
                relDetails.add(relToolDetail);
            }

            // 4.动作和工具
            if (null != actionInfo.getPluginId()) {
                SsResourceRelDetail relPluginDetail = new SsResourceRelDetail();
                relPluginDetail.setResourceRelDetailId(SequenceService.nextVal());
                relPluginDetail.setResourceId(actionInfo.getResourceId());
                relPluginDetail.setRelResourceId(actionInfo.getPluginId());
                relDetails.add(relPluginDetail);
            }

        }

        // 1.先删除动作关联的对象，函数和工具
        LambdaQueryWrapper<SsResourceRelDetail> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.in(SsResourceRelDetail::getResourceId, actionIds);
        ssResourceRelDetailMapper.delete(queryWrapper);

        // 2.插入所有关联信息
        // 2. 删除当前对象关联的动作
        List<SsResourceDTO> ssResourceDTOS = ssResourceMapper.selectRelResourceListByType(List.of(objResourceId),
            ResourceBizType.ACTION.getCode());
        List<Long> longs = ssResourceDTOS.stream().filter(item -> item.getRelDetailId() != null)
            .map(SsResourceDTO::getRelDetailId).toList();
        if (!longs.isEmpty()) {
            ssResourceRelDetailMapper.deleteBatchIds(longs);
        }
        // 2.插入新的关联关系
        ssResourceRelDetailMapper.insertBatch(relDetails);
    }

    /**
     * 处理动作属性（先查询数据库，然后对比得到增删改列表） 返回增删改列表，不执行操作
     */
    private ActionAttributeOperationLists processActionAttributes(OntologyBatchSaveRequest.ActionInfo actionInfo,
        Long actionResourceId, Long objId) {
        ActionAttributeOperationLists operationLists = new ActionAttributeOperationLists();

        // 如果前端没有传属性，删除该动作的所有属性,默认是属性全部清掉
        if (actionInfo.getAttributes() == null || actionInfo.getAttributes().isEmpty()) {
            LambdaQueryWrapper<SsResExtAttribute> queryWrapper = new LambdaQueryWrapper<>();
            queryWrapper.eq(SsResExtAttribute::getResourceId, actionResourceId).eq(SsResExtAttribute::getObjId, objId);
            List<SsResExtAttribute> existingAttrs = ssResExtAttributeMapper.selectList(queryWrapper);
            // 收集所有需要删除的属性ID
            for (SsResExtAttribute attr : existingAttrs) {
                operationLists.getDeleteList().add(attr.getExtAttributeId());
            }
            return operationLists;
        }

        // 1. 查询当前动作的所有属性
        LambdaQueryWrapper<SsResExtAttribute> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResExtAttribute::getResourceId, actionResourceId);
        List<SsResExtAttribute> existingAttrs = ssResExtAttributeMapper.selectList(queryWrapper);

        // 2. 构建对比Map：key为属性ID（extAttributeId），value为数据库实体
        Map<Long, SsResExtAttribute> existingAttrMap = new HashMap<>();
        for (SsResExtAttribute existingAttr : existingAttrs) {
            existingAttrMap.put(existingAttr.getExtAttributeId(), existingAttr);
        }

        // 3. 遍历前端传入的属性，判断是新增还是更新
        List<OntologyBatchSaveRequest.ActionAttribute> addList = new ArrayList<>();
        List<OntologyBatchSaveRequest.ActionAttribute> updateList = new ArrayList<>();

        for (OntologyBatchSaveRequest.ActionAttribute attr : actionInfo.getAttributes()) {
            if (attr.getExtAttributeId() == null) {
                // 没有ID，肯定是新增
                addList.add(attr);
            }
            else {
                // 有ID，需要判断是新增还是更新
                if (existingAttrMap.containsKey(attr.getExtAttributeId())) {
                    // ID在数据库中存在，按更新处理
                    updateList.add(attr);
                }
                else {
                    // ID不在数据库中，按新增处理
                    addList.add(attr);
                }
            }
        }

        // 4. 计算需要删除的属性（数据库中存在但不在updateList中的）
        // 删除列表 = 数据库中的属性ID - updateList中的属性ID
        Set<Long> updateAttrIds = updateList.stream().map(OntologyBatchSaveRequest.ActionAttribute::getExtAttributeId)
            .filter(id -> id != null).collect(Collectors.toSet());

        operationLists.getDeleteList().addAll(existingAttrMap.keySet().stream()
            .filter(attrId -> !updateAttrIds.contains(attrId)).collect(Collectors.toList()));

        // 5. 收集新增和更新的属性（带资源ID信息）
        for (OntologyBatchSaveRequest.ActionAttribute attr : addList) {
            operationLists.getAddList().add(new ActionAttributeWithResourceId(attr, actionResourceId, actionInfo));
        }
        for (OntologyBatchSaveRequest.ActionAttribute attr : updateList) {
            operationLists.getUpdateList().add(new ActionAttributeWithResourceId(attr, actionResourceId, actionInfo));
        }

        return operationLists;
    }

    /**
     * 从动作属性信息创建属性对象
     */
    private SsResExtAttribute createActionAttributeFromInfo(OntologyBatchSaveRequest.ActionAttribute attr,
        Long actionResourceId, OntologyBatchSaveRequest.ActionInfo actionInfo) {

        SsResExtAttribute attribute = new SsResExtAttribute();
        BeanUtils.copyProperties(attr, attribute);
        attribute.setResourceId(actionResourceId);

        // 只有在为空的时候才会写入
        if (attribute.getExtAttributeId() == null) {
            attribute.setExtAttributeId(SequenceService.nextVal());
        }

        // 设置extMeta（包含所有扩展字段）

        Map<String, Object> extMeta = MapParamUtil.objectToMap(attr);
        // 关联插件和工具信息
        if (actionInfo.getPluginId() != null) {
            extMeta.put("relPluginResourceId", actionInfo.getPluginId());
        }
        if (actionInfo.getToolId() != null) {
            extMeta.put("relToolResourceId", actionInfo.getToolId());
        }
        // 动作属性的权限
        if (attr.getPerDataScopeType() != null) {
            extMeta.put("perDataScopeType", attr.getPerDataScopeType());
        }

        setActionTermInfo(extMeta, attr);
        attribute.setExtMeta(JSON.toJSONString(extMeta));
        return attribute;
    }

    private void setActionTermInfo(Map<String, Object> extMeta, OntologyBatchSaveRequest.ActionAttribute attr) {
        if (attr.getDatasetId() != null) {
            extMeta.put("datasetId", attr.getDatasetId());
        }

        if (attr.getTermDataType() != null) {
            extMeta.put("termDataType", attr.getTermDataType());
        }

        if (attr.getTermTypeName() != null) {
            extMeta.put("termTypeName", attr.getTermTypeName());
        }
    }

    /**
     * 查询关联对象列表（包含对象基本信息和详情：属性、动作）
     *
     * @param resourceIds 资源ID集合
     * @return 对象列表（包含属性和动作）
     */
    public List<ObjectDto> queryRelObjects(Set<Long> resourceIds) {
        // 1. 查询对象基本信息
        List<ObjectDto> objectList = ssResourceMapper.queryRelObjects(resourceIds);

        if (objectList == null || objectList.isEmpty()) {
            return objectList;
        }

        // 2. 提取所有对象ID
        List<Long> objectIds = objectList.stream().map(ObjectDto::getResourceId).filter(id -> id != null)
            .collect(Collectors.toList());

        if (objectIds.isEmpty()) {
            return objectList;
        }

        // 3. 批量查询所有对象的属性（一次性查询）
        Map<Long, List<OntologyBatchSaveRequest.ObjectAttribute>> attributesMap = batchQueryObjectAttributes(objectIds);

        // 4. 批量查询所有对象的动作（一次性查询）
        Map<Long, List<OntologyDetailResponse.ActionDetail>> actionsMap = batchQueryActionsByObjectIds(objectIds);

        // 5. 填充每个对象的属性和动作
        for (ObjectDto objectDto : objectList) {
            Long resourceId = objectDto.getResourceId();
            if (resourceId == null) {
                continue;
            }
            objectDto.setAttributes(attributesMap.getOrDefault(resourceId, new ArrayList<>()));
            objectDto.setActions(actionsMap.getOrDefault(resourceId, new ArrayList<>()));
        }

        if (logger.isInfoEnabled()) {
            logger.info("查询关联对象列表成功，对象数量={}", objectList.size());
        }
        return objectList;
    }

    /**
     * 根据对象resourceId查询对象详情 包括：对象基本信息、对象属性、动作列表及动作属性
     *
     * @param resourceId 对象资源ID
     * @return 对象详情
     */
    public OntologyDetailResponse queryOntologyDetail(Long resourceId) {
        if (resourceId == null) {
            throw new BaseException(I18nUtil.get("ontology.object.resource.id.not.null"));
        }

        // 1. 查询对象基本信息
        SsResource objectResource = ssResourceMapper.selectById(resourceId);
        if (objectResource == null) {
            throw new BaseException(I18nUtil.get("ontology.object.not.exist.with.id", resourceId));
        }
        if (!"OBJECT".equals(objectResource.getResourceBizType())) {
            throw new BaseException(I18nUtil.get("ontology.resource.not.object.type.with.id", resourceId));
        }

        // 2. 构建响应对象
        OntologyDetailResponse response = new OntologyDetailResponse();
        response.setResourceId(objectResource.getResourceId());
        response.setName(objectResource.getResourceName());
        response.setDesc(objectResource.getResourceDesc());
        response.setCatalogId(objectResource.getCatalogId());
        // 转换 resourceType 为 sourceType
        response.setSourceType(convertResourceTypeToSourceType(objectResource.getResourceType()));

        // 3. 查询对象属性（objId为空表示对象属性）
        List<SsResExtAttribute> objectAttrs = queryObjectAttributes(resourceId);
        response.setAttributes(convertToObjectAttributeList(objectAttrs));

        // 4. 查询动作列表
        List<OntologyDetailResponse.ActionDetail> actions = queryActionsByObjectId(resourceId);
        response.setActions(actions);

        if (logger.isInfoEnabled()) {
            logger.info("查询对象详情成功，resourceId={}, 属性数量={}, 动作数量={}", resourceId, response.getAttributes().size(),
                actions.size());
        }

        return response;
    }

    /**
     * 查询对象属性（objId为空的属性）
     *
     * @param resourceId 对象资源ID
     * @return 对象属性列表
     */
    private List<SsResExtAttribute> queryObjectAttributes(Long resourceId) {
        LambdaQueryWrapper<SsResExtAttribute> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResExtAttribute::getResourceId, resourceId).isNull(SsResExtAttribute::getObjId)
            .orderByAsc(SsResExtAttribute::getSort);
        return ssResExtAttributeMapper.selectList(queryWrapper);
    }

    /**
     * 批量查询对象属性（objId为空的属性）
     *
     * @param resourceIds 对象资源ID列表
     * @return Map<资源ID, 对象属性列表>
     */
    private Map<Long, List<OntologyBatchSaveRequest.ObjectAttribute>> batchQueryObjectAttributes(
        List<Long> resourceIds) {
        if (resourceIds == null || resourceIds.isEmpty()) {
            return new HashMap<>();
        }

        // 批量查询所有对象的属性
        LambdaQueryWrapper<SsResExtAttribute> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.in(SsResExtAttribute::getResourceId, resourceIds).isNull(SsResExtAttribute::getObjId)
            .orderByAsc(SsResExtAttribute::getSort);
        List<SsResExtAttribute> allAttrs = ssResExtAttributeMapper.selectList(queryWrapper);

        // 按资源ID分组并转换为ObjectAttribute
        Map<Long, List<SsResExtAttribute>> attrsByResourceId = allAttrs.stream()
            .collect(Collectors.groupingBy(SsResExtAttribute::getResourceId));

        // 转换为ObjectAttribute并返回Map
        Map<Long, List<OntologyBatchSaveRequest.ObjectAttribute>> result = new HashMap<>();
        for (Map.Entry<Long, List<SsResExtAttribute>> entry : attrsByResourceId.entrySet()) {
            result.put(entry.getKey(), convertToObjectAttributeList(entry.getValue()));
        }

        return result;
    }

    /**
     * 根据对象ID查询动作列表及其属性
     *
     * @param objResourceId 对象资源ID
     * @return 动作详情列表
     */
    private List<OntologyDetailResponse.ActionDetail> queryActionsByObjectId(Long objResourceId) {
        // 1. 通过关联表查询动作资源ID列表
        LambdaQueryWrapper<SsResourceRelDetail> relQueryWrapper = new LambdaQueryWrapper<>();
        relQueryWrapper.eq(SsResourceRelDetail::getResourceId, objResourceId);
        List<SsResourceRelDetail> relDetails = ssResourceRelDetailMapper.selectList(relQueryWrapper);

        if (relDetails.isEmpty()) {
            return new ArrayList<>();
        }

        // 2. 提取动作资源ID列表
        List<Long> actionResourceIds = relDetails.stream().map(SsResourceRelDetail::getRelResourceId)
            .filter(id -> id != null).collect(Collectors.toList());

        if (actionResourceIds.isEmpty()) {
            return new ArrayList<>();
        }

        // 3. 批量查询动作资源信息
        LambdaQueryWrapper<SsResource> resourceQueryWrapper = new LambdaQueryWrapper<>();
        resourceQueryWrapper.in(SsResource::getResourceId, actionResourceIds)
            .eq(SsResource::getResourceBizType, ResourceBizType.ACTION.getCode());
        List<SsResource> actionResources = ssResourceMapper.selectList(resourceQueryWrapper);

        // 4. 批量查询所有动作属性
        LambdaQueryWrapper<SsResExtAttribute> attrQueryWrapper = new LambdaQueryWrapper<>();
        attrQueryWrapper.in(SsResExtAttribute::getResourceId, actionResourceIds).orderByAsc(SsResExtAttribute::getSort);
        List<SsResExtAttribute> allActionAttrs = ssResExtAttributeMapper.selectList(attrQueryWrapper);

        // 5. 按动作ID分组属性
        Map<Long, List<SsResExtAttribute>> attrsByActionId = allActionAttrs.stream()
            .collect(Collectors.groupingBy(SsResExtAttribute::getResourceId));

        // 8. 组装动作详情列表
        List<OntologyDetailResponse.ActionDetail> actionDetails = new ArrayList<>();
        for (SsResource actionResource : actionResources) {
            OntologyDetailResponse.ActionDetail actionDetail = new OntologyDetailResponse.ActionDetail();
            actionDetail.setResourceId(actionResource.getResourceId());
            actionDetail.setName(actionResource.getResourceName());
            actionDetail.setDesc(actionResource.getResourceDesc());
            actionDetail.setCode(actionResource.getResourceCode());
            actionDetail.setCreateTime(actionResource.getCreateTime());

            // 获取该动作的属性列表并转换为ActionAttribute格式
            List<SsResExtAttribute> actionAttrs = attrsByActionId.getOrDefault(actionResource.getResourceId(),
                new ArrayList<>());
            actionDetail.setAttributes(convertToActionAttributeList(actionAttrs));

            // 不为空才取值
            if (!actionAttrs.isEmpty()) {
                // 从属性里面取值
                OntologyBatchSaveRequest.ActionAttribute actionAttribute = actionDetail.getAttributes().get(0);
                actionDetail.setToolId(actionAttribute.getRelToolResourceId());
                actionDetail.setPluginId(actionAttribute.getRelPluginResourceId());
                actionDetails.add(actionDetail);
            }
        }

        return actionDetails;
    }

    /**
     * 批量查询对象动作列表及其属性
     *
     * @param objResourceIds 对象资源ID列表
     * @return Map<对象资源ID, 动作详情列表>
     */
    private Map<Long, List<OntologyDetailResponse.ActionDetail>> batchQueryActionsByObjectIds(
        List<Long> objResourceIds) {
        if (objResourceIds == null || objResourceIds.isEmpty()) {
            return new HashMap<>();
        }

        // 1. 查询关联关系并按对象ID分组，提取动作资源ID
        Map<Long, List<Long>> actionIdsByObjectId = groupActionIdsByObjectId(objResourceIds);
        if (actionIdsByObjectId.isEmpty()) {
            return new HashMap<>();
        }

        // 2. 收集所有动作资源ID
        Set<Long> allActionResourceIds = actionIdsByObjectId.values().stream().flatMap(List::stream)
            .collect(Collectors.toSet());

        if (allActionResourceIds.isEmpty()) {
            return new HashMap<>();
        }

        // 3. 批量查询动作资源和属性
        List<SsResource> allActionResources = queryActionResources(allActionResourceIds);
        Map<Long, List<SsResExtAttribute>> attrsByActionId = queryAndGroupActionAttributes(allActionResourceIds);

        // 4. 构建动作资源ID到动作详情的映射
        Map<Long, OntologyDetailResponse.ActionDetail> actionDetailMap = buildActionDetailMap(allActionResources,
            attrsByActionId);

        // 5. 按对象ID分组动作详情
        return groupActionDetailsByObjectId(actionIdsByObjectId, actionDetailMap);
    }

    /**
     * 查询关联关系并按对象ID分组，提取动作资源ID
     *
     * @param objResourceIds 对象资源ID列表
     * @return Map<对象ID, 动作ID列表>
     */
    private Map<Long, List<Long>> groupActionIdsByObjectId(List<Long> objResourceIds) {
        // 批量查询所有对象的关联关系（一次性查询）
        LambdaQueryWrapper<SsResourceRelDetail> relQueryWrapper = new LambdaQueryWrapper<>();
        relQueryWrapper.in(SsResourceRelDetail::getResourceId, objResourceIds);
        List<SsResourceRelDetail> allRelDetails = ssResourceRelDetailMapper.selectList(relQueryWrapper);

        if (allRelDetails.isEmpty()) {
            return new HashMap<>();
        }

        // 按对象ID分组关联关系，提取动作资源ID
        Map<Long, List<Long>> actionIdsByObjectId = new HashMap<>();
        for (SsResourceRelDetail relDetail : allRelDetails) {
            Long objId = relDetail.getResourceId();
            Long actionId = relDetail.getRelResourceId();
            if (objId != null && actionId != null) {
                actionIdsByObjectId.computeIfAbsent(objId, k -> new ArrayList<>()).add(actionId);
            }
        }

        return actionIdsByObjectId;
    }

    /**
     * 批量查询动作资源信息
     *
     * @param actionResourceIds 动作资源ID集合
     * @return 动作资源列表
     */
    private List<SsResource> queryActionResources(Set<Long> actionResourceIds) {
        LambdaQueryWrapper<SsResource> resourceQueryWrapper = new LambdaQueryWrapper<>();
        resourceQueryWrapper.in(SsResource::getResourceId, actionResourceIds)
            .eq(SsResource::getResourceBizType, ResourceBizType.ACTION.getCode());
        return ssResourceMapper.selectList(resourceQueryWrapper);
    }

    /**
     * 批量查询动作属性并按动作ID分组
     *
     * @param actionResourceIds 动作资源ID集合
     * @return Map<动作ID, 属性列表>
     */
    private Map<Long, List<SsResExtAttribute>> queryAndGroupActionAttributes(Set<Long> actionResourceIds) {
        LambdaQueryWrapper<SsResExtAttribute> attrQueryWrapper = new LambdaQueryWrapper<>();
        attrQueryWrapper.in(SsResExtAttribute::getResourceId, actionResourceIds).orderByAsc(SsResExtAttribute::getSort);
        List<SsResExtAttribute> allActionAttrs = ssResExtAttributeMapper.selectList(attrQueryWrapper);

        return allActionAttrs.stream().collect(Collectors.groupingBy(SsResExtAttribute::getResourceId));
    }

    /**
     * 构建动作资源ID到动作详情的映射
     *
     * @param allActionResources 所有动作资源列表
     * @param attrsByActionId 按动作ID分组的属性映射
     * @return Map<动作资源ID, 动作详情>
     */
    private Map<Long, OntologyDetailResponse.ActionDetail> buildActionDetailMap(List<SsResource> allActionResources,
        Map<Long, List<SsResExtAttribute>> attrsByActionId) {
        Map<Long, OntologyDetailResponse.ActionDetail> actionDetailMap = new HashMap<>();
        for (SsResource actionResource : allActionResources) {
            OntologyDetailResponse.ActionDetail actionDetail = createActionDetail(actionResource, attrsByActionId);
            actionDetailMap.put(actionResource.getResourceId(), actionDetail);
        }
        return actionDetailMap;
    }

    /**
     * 创建动作详情对象
     *
     * @param actionResource 动作资源
     * @param attrsByActionId 按动作ID分组的属性映射
     * @return 动作详情
     */
    private OntologyDetailResponse.ActionDetail createActionDetail(SsResource actionResource,
        Map<Long, List<SsResExtAttribute>> attrsByActionId) {
        OntologyDetailResponse.ActionDetail actionDetail = new OntologyDetailResponse.ActionDetail();
        actionDetail.setResourceId(actionResource.getResourceId());
        actionDetail.setName(actionResource.getResourceName());
        actionDetail.setDesc(actionResource.getResourceDesc());
        actionDetail.setCode(actionResource.getResourceCode());
        actionDetail.setCreateTime(actionResource.getCreateTime());

        // 获取该动作的属性列表并转换为ActionAttribute格式
        List<SsResExtAttribute> actionAttrs = attrsByActionId.getOrDefault(actionResource.getResourceId(),
            new ArrayList<>());
        actionDetail.setAttributes(convertToActionAttributeList(actionAttrs));

        // 不为空才取值
        if (!actionAttrs.isEmpty()) {
            // 从属性里面取值
            OntologyBatchSaveRequest.ActionAttribute actionAttribute = actionDetail.getAttributes().get(0);
            actionDetail.setToolId(actionAttribute.getRelToolResourceId());
            actionDetail.setPluginId(actionAttribute.getRelPluginResourceId());
        }

        return actionDetail;
    }

    /**
     * 按对象ID分组动作详情
     *
     * @param actionIdsByObjectId 按对象ID分组的动作ID映射
     * @param actionDetailMap 动作详情映射
     * @return Map<对象ID, 动作详情列表>
     */
    private Map<Long, List<OntologyDetailResponse.ActionDetail>> groupActionDetailsByObjectId(
        Map<Long, List<Long>> actionIdsByObjectId, Map<Long, OntologyDetailResponse.ActionDetail> actionDetailMap) {
        Map<Long, List<OntologyDetailResponse.ActionDetail>> result = new HashMap<>();
        for (Map.Entry<Long, List<Long>> entry : actionIdsByObjectId.entrySet()) {
            Long objId = entry.getKey();
            List<Long> actionIds = entry.getValue();
            List<OntologyDetailResponse.ActionDetail> actionDetails = buildActionDetailsList(actionIds,
                actionDetailMap);
            result.put(objId, actionDetails);
        }
        return result;
    }

    /**
     * 构建动作详情列表
     *
     * @param actionIds 动作ID列表
     * @param actionDetailMap 动作详情映射
     * @return 动作详情列表
     */
    private List<OntologyDetailResponse.ActionDetail> buildActionDetailsList(List<Long> actionIds,
        Map<Long, OntologyDetailResponse.ActionDetail> actionDetailMap) {
        List<OntologyDetailResponse.ActionDetail> actionDetails = new ArrayList<>();
        for (Long actionId : actionIds) {
            OntologyDetailResponse.ActionDetail actionDetail = actionDetailMap.get(actionId);
            if (actionDetail != null) {
                actionDetails.add(actionDetail);
            }
        }
        return actionDetails;
    }

    /**
     * 将SsResExtAttribute转换为ObjectAttribute列表 解析extMeta中的isBizId和relInfos
     *
     * @param attrs 属性实体列表
     * @return ObjectAttribute列表
     */
    private List<OntologyBatchSaveRequest.ObjectAttribute> convertToObjectAttributeList(List<SsResExtAttribute> attrs) {
        if (attrs == null || attrs.isEmpty()) {
            return new ArrayList<>();
        }

        List<OntologyBatchSaveRequest.ObjectAttribute> result = new ArrayList<>();
        for (SsResExtAttribute attr : attrs) {
            OntologyBatchSaveRequest.ObjectAttribute objectAttr = new OntologyBatchSaveRequest.ObjectAttribute();
            BeanUtils.copyProperties(attr, objectAttr);

            // 解析extMeta字段
            parseExtMetaForObjectAttribute(attr, objectAttr);

            result.add(objectAttr);
        }
        return result;
    }

    /**
     * 将SsResExtAttribute转换为ActionAttribute列表 解析extMeta中的所有扩展字段
     *
     * @param attrs 属性实体列表
     * @return ActionAttribute列表
     */
    private List<OntologyBatchSaveRequest.ActionAttribute> convertToActionAttributeList(List<SsResExtAttribute> attrs) {
        if (attrs == null || attrs.isEmpty()) {
            return new ArrayList<>();
        }

        List<OntologyBatchSaveRequest.ActionAttribute> result = new ArrayList<>();
        for (SsResExtAttribute attr : attrs) {
            OntologyBatchSaveRequest.ActionAttribute actionAttr = new OntologyBatchSaveRequest.ActionAttribute();
            BeanUtils.copyProperties(attr, actionAttr);

            // 解析extMeta字段
            parseExtMetaForActionAttribute(attr, actionAttr);

            result.add(actionAttr);
        }
        return result;
    }

    /**
     * 解析extMeta字段，填充ObjectAttribute的扩展字段 包括：isBizId、relInfos
     *
     * @param attr 数据库实体
     * @param objectAttr DTO对象
     */
    private void parseExtMetaForObjectAttribute(SsResExtAttribute attr,
        OntologyBatchSaveRequest.ObjectAttribute objectAttr) {
        if (StringUtils.isBlank(attr.getExtMeta())) {
            return;
        }

        Map<String, Object> extMeta = (Map<String, Object>) JSON.parseObject(attr.getExtMeta(), Map.class);
        if (extMeta == null) {
            return;
        }

        // 解析业务主键,标签，是否查询条件
        objectAttr.setIsBizId(MapUtils.getIntValue(extMeta, "isBizId"));

        objectAttr.setIsBizLabel(MapUtils.getIntValue(extMeta, "isBizLabel"));

        objectAttr.setIsQueryAttr(MapUtils.getBoolean(extMeta, "isQueryAttr"));

        objectAttr.setTermDataType(MapUtils.getString(extMeta, "termDataType"));

        objectAttr.setTermTypeName(MapUtils.getString(extMeta, "termTypeName"));

        objectAttr.setDatasetId(MapUtils.getString(extMeta, "datasetId"));

        objectAttr.setPerDataScopeType(MapUtils.getString(extMeta, "perDataScopeType"));
        // 解析关联的函数信息列表（relInfos）
        List<Map<String, Object>> relInfosList = (List<Map<String, Object>>) extMeta.get("relInfos");
        List<OntologyBatchSaveRequest.FunctionInfo> functionInfoList = new ArrayList<>();
        for (int i = 0; relInfosList != null && i < relInfosList.size(); i++) {
            OntologyBatchSaveRequest.FunctionInfo functionInfo = new OntologyBatchSaveRequest.FunctionInfo();
            MapParamUtil.copyProperties(relInfosList.get(i), functionInfo);
            functionInfoList.add(functionInfo);
        }

        objectAttr.setRelInfos(functionInfoList);

    }

    /**
     * 解析extMeta字段，填充ActionAttribute的扩展字段
     * 包括：isBizId、relObjId、relObjAttributeId、actionXpath、relToolParamXpath、relPluginResourceId等
     *
     * @param attr 数据库实体
     * @param actionAttr DTO对象
     */
    private void parseExtMetaForActionAttribute(SsResExtAttribute attr,
        OntologyBatchSaveRequest.ActionAttribute actionAttr) {
        if (StringUtils.isBlank(attr.getExtMeta())) {
            return;
        }

        Map<String, Object> extMeta = (Map<String, Object>) JSON.parseObject(attr.getExtMeta(), Map.class);
        if (extMeta == null) {
            return;
        }

        MapParamUtil.copyProperties(extMeta, actionAttr);
    }

    public void deleteRelation(@Valid OntologyDeleteRequest request) {
        Long resourceId = request.getResourceId();
        Long relObjId = request.getRelObjId();
        List<Long> idList = List.of(resourceId, relObjId);
        LambdaQueryWrapper<SsResourceRelDetail> wrapper = new LambdaQueryWrapper<>();
        wrapper.in(SsResourceRelDetail::getResourceId, idList);
        wrapper.in(SsResourceRelDetail::getRelResourceId, idList);
        ssResourceRelDetailMapper.delete(wrapper);

    }

    /**
     * 带资源ID的动作属性（用于批量处理）
     */
    private record ActionAttributeWithResourceId(OntologyBatchSaveRequest.ActionAttribute attribute,
        Long actionResourceId, OntologyBatchSaveRequest.ActionInfo actionInfo) {
    }

    /**
     * 动作属性操作列表（用于批量处理）
     */
    private static final class ActionAttributeOperationLists {
        private final List<Long> deleteList = new ArrayList<>();

        private final List<ActionAttributeWithResourceId> addList = new ArrayList<>();

        private final List<ActionAttributeWithResourceId> updateList = new ArrayList<>();

        /**
         * 获取删除列表
         *
         * @return 删除列表
         */
        public List<Long> getDeleteList() {
            return deleteList;
        }

        /**
         * 获取新增列表
         *
         * @return 新增列表
         */
        public List<ActionAttributeWithResourceId> getAddList() {
            return addList;
        }

        /**
         * 获取更新列表
         *
         * @return 更新列表
         */
        public List<ActionAttributeWithResourceId> getUpdateList() {
            return updateList;
        }
    }
}
