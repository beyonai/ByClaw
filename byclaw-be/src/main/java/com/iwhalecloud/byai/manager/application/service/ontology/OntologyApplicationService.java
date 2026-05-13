package com.iwhalecloud.byai.manager.application.service.ontology;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import org.apache.commons.collections.MapUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.domain.resource.service.OntologyService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.ontology.ByaiDbresourceRelService;
import com.iwhalecloud.byai.manager.dto.ontology.ObjectDto;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyActionSaveRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyAttributeSaveRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyBatchSaveRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyQueryRequest;
import com.iwhalecloud.byai.manager.dto.ontology.TermInfo;
import com.iwhalecloud.byai.manager.dto.ontology.ToolParam;
import com.iwhalecloud.byai.manager.entity.ontology.ByaiDbresourceRel;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtAttribute;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtAttributeMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.ontology.SourceType;
import com.iwhalecloud.byai.common.constants.resource.ResourceType;
import jakarta.validation.Valid;
import net.sourceforge.pinyin4j.PinyinHelper;
import net.sourceforge.pinyin4j.format.HanyuPinyinCaseType;
import net.sourceforge.pinyin4j.format.HanyuPinyinOutputFormat;
import net.sourceforge.pinyin4j.format.HanyuPinyinToneType;
import net.sourceforge.pinyin4j.format.exception.BadHanyuPinyinOutputFormatCombination;

@Service
public class OntologyApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(OntologyApplicationService.class);


    @Autowired
    private OntologyService ontologyService;

    @Autowired
    private ByaiDbresourceRelService byaiDbresourceRelService;

    @Autowired
    private SsResourceRelDetailService ssResourceRelDetailService;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private SsResExtAttributeMapper ssResExtAttributeMapper;

    @Value("${ext.skip.fields:isBizId,isBizLabel,isQueryAttr,termTypeName,datasetId,termDataType}")
    public String extFields;

    public List<ObjectDto> queryRelObjects(OntologyQueryRequest request) {
        Long resourceId = request.getResourceId();
        List<SsResourceRelDetail> relDetails = ssResourceRelDetailService.findByResourceId(resourceId);
        Set<Long> set = new HashSet<>();
        set.add(resourceId);
        relDetails.stream().filter(item -> item.getRelResourceId() != null)
            .forEach(item -> set.add(item.getRelResourceId()));
        return ontologyService.queryRelObjects(set);

    }

    /**
     * 保存对象属性 根据前端传入的 attributes 自动判断哪些是 ADD、MODIFY、DELETE
     *
     * @param request 属性保存请求
     * @return 保存结果
     */
    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> saveAttributes(@Valid OntologyAttributeSaveRequest request) {
        // 首先判断是否有库id存在
        Long dbId;
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        List<ByaiDbresourceRel> rels = byaiDbresourceRelService.findByObjId(currentUserId);

        // 对象的id
        Long resourceId = request.getResourceId();

        // 查询资源信息，判断是否为数据库表类型
        SsResource resource = ssResourceService.findById(resourceId);
        if (resource == null) {
            throw new BaseException(I18nUtil.get("ontology.application.resource.not.exist", resourceId));
        }

        if (rels == null || rels.isEmpty()) {
            // 如果不存在，创建新的关联关系
            dbId = createDbId(currentUserId, resource);
        }
        else {
            dbId = rels.get(0).getRecordId();
        }

        // 1. 从数据库查询现有的对象属性
        Map<Long, SsResExtAttribute> existingAttrMap = getExistingAttributes(resourceId);

        // 2. 根据前端传入的属性列表，判断哪些是 ADD、MODIFY、DELETE
        List<OntologyBatchSaveRequest.ObjectAttribute> addList = new ArrayList<>();
        List<OntologyBatchSaveRequest.ObjectAttribute> modifyList = new ArrayList<>();
        List<Long> deleteList = new ArrayList<>();

        buildOperateLists(request, existingAttrMap, addList, modifyList, deleteList);

        logger.info("属性操作分类完成，resourceId={}, 新增={}, 修改={}, 删除={}", resourceId, addList.size(), modifyList.size(),
            deleteList.size());

        // 3. 如果是数据库表类型，需要先调用表结构创建或修改接口（在数据库操作之前）
        if (isDatabaseTableType(resource)) {
            KnowledgeResponse<?> response;
            if (existingAttrMap.isEmpty()) {
                // 第一次创建表

                // 更新对象对应的tableId
                resource.setResourceSourcePkId(null);
                ssResourceService.update(resource);
            }
            else {
                // 修改表结构 - 只有当真正有变更时才调用接口

            }
        }

        // 4. 执行属性表的增删改操作A-ADD D-DEL M-MODIFY Q-QUERY
        List<SsResExtAttribute> attributes = ontologyService.dealADMQ(deleteList, addList, modifyList, resourceId);

        // 通用型数据库增加默认传sourceType 4
        ontologyService.createVirtualActions(resource.getResourceId(), resource.getResourceName(),
            SourceType.COMMON_DB);
        // 5. 返回结果
        Map<String, Object> response = new HashMap<>();
        response.put("resourceId", resourceId);
        response.put("attributes", attributes.isEmpty() ? request.getAttributes() : attributes);

        return response;
    }

    /**
     * 构建操作列表（新增、修改、删除） 优化：只有当字段值真正发生变化时，才加入修改列表
     *
     * @param request 请求对象
     * @param existingAttrMap 现有属性Map
     * @param addList 新增列表
     * @param modifyList 修改列表
     * @param deleteList 删除列表
     */
    private void buildOperateLists(@Valid OntologyAttributeSaveRequest request,
        Map<Long, SsResExtAttribute> existingAttrMap, List<OntologyBatchSaveRequest.ObjectAttribute> addList,
        List<OntologyBatchSaveRequest.ObjectAttribute> modifyList, List<Long> deleteList) {

        if (request.getAttributes() == null || request.getAttributes().isEmpty()) {
            // 如果前端没有传属性，说明要清空所有属性
            deleteList.addAll(existingAttrMap.keySet());
        }
        else {
            // 遍历前端传入的属性，判断是新增还是修改
            Set<Long> frontendAttrIds = new HashSet<>();
            for (OntologyBatchSaveRequest.ObjectAttribute attr : request.getAttributes()) {
                if (attr.getExtAttributeId() != null) {
                    frontendAttrIds.add(attr.getExtAttributeId());
                    if (existingAttrMap.containsKey(attr.getExtAttributeId())) {
                        // ID在数据库中存在，需要判断字段是否真正发生变化
                        SsResExtAttribute existingAttr = existingAttrMap.get(attr.getExtAttributeId());
                        if (hasAttributeChanged(attr, existingAttr)) {
                            modifyList.add(attr);
                        }

                    }
                    else {
                        // ID不在数据库中，按新增处理
                        addList.add(attr);
                    }
                }
                else {
                    addList.add(attr);
                }
            }

            // 计算需要删除的属性（数据库中存在但前端没有传入的）
            for (Map.Entry<Long, SsResExtAttribute> entry : existingAttrMap.entrySet()) {
                Long attrId = entry.getKey();
                if (!frontendAttrIds.contains(attrId)) {
                    deleteList.add(attrId);
                }
            }
        }
    }

    /**
     * 判断属性是否真正发生变化 将新旧属性转换为Map，遍历旧属性Map，比较新属性Map中的值是否有变化 跳过 extMeta 字段的比较
     *
     * @param newAttr 前端传入的属性
     * @param existingAttr 数据库中现有的属性
     * @return true-有变化，false-无变化
     */
    private boolean hasAttributeChanged(OntologyBatchSaveRequest.ObjectAttribute newAttr,
        SsResExtAttribute existingAttr) {
        // 将新旧属性转换为Map
        Map<String, Object> newAttrMap = (JSONObject) JSONObject.toJSON(newAttr);

        Map<String, Object> existingAttrMap = (JSONObject) JSONObject.toJSON(existingAttr);

        // 遍历旧属性Map，比较新属性Map中的值
        for (Map.Entry<String, Object> entry : existingAttrMap.entrySet()) {
            String fieldName = entry.getKey();
            // 跳过 extAttributeId、resourceId 等ID字段（这些字段不参与表结构变更判断）
            if ("extAttributeId".equals(fieldName) || "resourceId".equals(fieldName) || "objId".equals(fieldName)
                || "relInfos".equals(fieldName)) {
                continue;
            }

            // 跳过 extMeta 字段
            if ("extMeta".equals(fieldName)) {
                if (!noChange(extFields, newAttrMap, existingAttrMap)) {
                    return true;
                }
                continue;
            }

            Object oldValue = entry.getValue();
            Object newValue = newAttrMap.get(fieldName);
            // 比较值是否相等
            if (!isValueEqual(oldValue, newValue)) {
                return true;
            }
        }
        // 所有字段都没有变化，返回false
        return false;
    }

    private boolean noChange(String extFields, Map<String, Object> newAttrMap, Map<String, Object> existingAttrMap) {

        // 需要对比一些扩展字段的内容
        String[] extMeta = extFields.split(",");
        Map<String, Object> extMap = MapUtils.getMap(existingAttrMap, "extMeta");
        for (String extField : extMeta) {
            Object oldValue = null != extMap ? MapUtils.getObject(extMap, extField) : null;
            Object newValue = newAttrMap.get(extField);
            if (!isValueEqual(oldValue, newValue)) {
                return false;
            }
        }

        return true;
    }

    /**
     * 比较两个值是否相等（处理null、字符串trim、Integer等类型）
     *
     * @param oldValue 旧值
     * @param newValue 新值
     * @return true-相等，false-不相等
     */
    private boolean isValueEqual(Object oldValue, Object newValue) {
        // 都为空，认为相等
        if (oldValue == null && newValue == null) {
            return true;
        }

        // 一个为空一个不为空，不相等
        if (oldValue == null || newValue == null) {
            return false;
        }

        // 如果是字符串，trim后比较
        if (oldValue instanceof String && newValue instanceof String) {
            String oldStr = ((String) oldValue).trim();
            String newStr = ((String) newValue).trim();
            return oldStr.equals(newStr);
        }

        // 如果是Integer，直接比较（因为前面已经判断了null，这里不会为null）
        if (oldValue instanceof Integer && newValue instanceof Integer) {
            return oldValue.equals(newValue);
        }

        // 其他类型直接比较
        return oldValue.equals(newValue);
    }

    /**
     * 检查 Feign 调用响应结果
     *
     * @param response 响应对象
     * @param errorMsg 错误信息前缀
     */
    private Long checkFeignCreateResponse(KnowledgeResponse<?> response, String errorMsg) {
        if (response == null || !KnowledgeResponse.RESPONSE_SUCCESS.equals(response.getResultCode())) {
            throw new BaseException(I18nUtil.get("ontology.application.feign.error", errorMsg,
                response != null ? response.getResultObject() : I18nUtil.get("common.unknown.error")));
        }
        String tableId = (String) response.getResultObject();
        return Long.parseLong(tableId);
    }

    private void checkFeignAlterResponse(KnowledgeResponse<?> response, String errorMsg) {
        if (response == null || !KnowledgeResponse.RESPONSE_SUCCESS.equals(response.getResultCode())) {
            throw new BaseException(I18nUtil.get("ontology.application.feign.error", errorMsg,
                response != null ? response.getResultObject() : I18nUtil.get("common.unknown.error")));
        }

    }

    /**
     * 创建数据库ID（如果不存在关联关系则创建）
     *
     * @param currentUserId 当前用户ID
     * @param resource
     * @return 数据库ID
     */
    private Long createDbId(Long currentUserId, SsResource resource) {
        return -1L;
    }

    /**
     * 查询现有的对象属性
     *
     * @param resourceId 资源ID
     * @return 属性Map，key为extAttributeId，value为属性实体
     */
    private Map<Long, SsResExtAttribute> getExistingAttributes(Long resourceId) {
        LambdaQueryWrapper<SsResExtAttribute> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResExtAttribute::getResourceId, resourceId);
        List<SsResExtAttribute> existingAttrs = ssResExtAttributeMapper.selectList(queryWrapper);

        Map<Long, SsResExtAttribute> existingAttrMap = new HashMap<>();
        for (SsResExtAttribute existingAttr : existingAttrs) {
            existingAttrMap.put(existingAttr.getExtAttributeId(), existingAttr);
        }
        return existingAttrMap;
    }

    /**
     * 判断是否为数据库表类型
     *
     * @param resource 资源对象
     * @return 是否为数据库表类型
     */
    private boolean isDatabaseTableType(SsResource resource) {
        // 根据 resourceBizType 判断是否为数据库类型
        // resourceBizType 可能的值：DB-数据库，KG_DB-数据知识库
        if (resource.getResourceBizType() == null) {
            return false;
        }
        String bizType = resource.getResourceBizType();
        String resourceType = resource.getResourceType();
        return Constants.ResourceBizType.OBJECT.equals(bizType) && ResourceType.COMMON_DB.equals(resourceType);
    }

    /**
     * 构造创建表请求参数 根据属性列表构造创建表请求参数
     *
     * @param dbId 数据库ID
     * @param resource 资源对象
     * @param attributes 属性列表
     * @return 创建表请求参数
     */
    private Map<String, Object> buildCreateTableParams(Long dbId, SsResource resource,
        List<OntologyBatchSaveRequest.ObjectAttribute> attributes) {

        Map<String, Object> params = new HashMap<>();
        params.put("dynamicRecordId", dbId);
        params.put("tableDesc", resource.getResourceDesc());
        params.put("tableCode", getTableName(resource));
        List<Map<String, Object>> columns = new ArrayList<>();

        // 遍历属性列表，构造列定义
        if (attributes != null && !attributes.isEmpty()) {
            for (OntologyBatchSaveRequest.ObjectAttribute attr : attributes) {
                Map<String, Object> column = new HashMap<>();
                column.put("columnName", attr.getAttributeCode());
                column.put("columnType", convertDataTypeForCreate(attr.getType()));
                column.put("columnDesc", attr.getAttributeDesc());
                column.put("nullable", attr.getIsRequired() != null && attr.getIsRequired() == 1);
                // column.put("length", false);
                // column.put("scale", 2);
                // column.put("precision", 10);
                columns.add(column);
            }
        }
        params.put("columns", columns);
        logger.info("构造创建表参数完成{}", JSON.toJSONString(params));
        return params;
    }

    /**
     * 构造表结构修改请求参数 根据 ADD、MODIFY、DELETE 操作列表构造请求参数
     *
     * @param resource 资源对象
     * @param addList 新增属性列表
     * @param modifyList 修改属性列表
     * @param deleteList 删除属性ID列表
     * @param existingAttrMap 现有属性Map
     * @return 表结构修改请求参数
     */
    private Map<String, Object> buildTableStructureModifyParams(SsResource resource,
        List<OntologyBatchSaveRequest.ObjectAttribute> addList,
        List<OntologyBatchSaveRequest.ObjectAttribute> modifyList, List<Long> deleteList,
        Map<Long, SsResExtAttribute> existingAttrMap) {

        Map<String, Object> params = new HashMap<>();
        params.put("dynamicTableId", resource.getResourceSourcePkId());
        params.put("tableName", getTableName(resource));
        params.put("tableDesc", resource.getResourceDesc());
        List<Map<String, Object>> operations = new ArrayList<>();

        // 处理 ADD 操作
        for (OntologyBatchSaveRequest.ObjectAttribute attr : addList) {
            Map<String, Object> operation = new HashMap<>();
            operation.put("operationType", "ADD");
            operation.put("columnName", attr.getAttributeCode());
            operation.put("columnType", convertDataTypeForCreate(attr.getType()));
            operation.put("columnDesc", attr.getAttributeDesc());
            operation.put("nullable", attr.getIsRequired() != null && attr.getIsRequired() == 1);
            operations.add(operation);
        }

        // 处理 MODIFY 操作
        for (OntologyBatchSaveRequest.ObjectAttribute attr : modifyList) {
            SsResExtAttribute oldAttr = existingAttrMap.get(attr.getExtAttributeId());
            Map<String, Object> operation = new HashMap<>();
            operation.put("operationType", "MODIFY");
            operation.put("oldColumnName", oldAttr.getAttributeCode());
            operation.put("columnName", attr.getAttributeCode());
            operation.put("columnType", convertDataTypeForCreate(attr.getType()));
            operation.put("nullable", attr.getIsRequired() != null && attr.getIsRequired() == 1);
            operation.put("columnDesc", attr.getAttributeDesc());
            operations.add(operation);
        }

        // 处理 DELETE 操作
        for (Long attrId : deleteList) {
            SsResExtAttribute existingAttr = existingAttrMap.get(attrId);
            if (existingAttr != null) {
                Map<String, Object> operation = new HashMap<>();
                operation.put("operationType", "DROP");
                operation.put("columnName", existingAttr.getAttributeCode());
                operations.add(operation);
            }
        }

        params.put("columns", operations);

        logger.info("构造表结构修改参数完成{}", JSON.toJSONString(params));
        return params;
    }

    /**
     * 获取表名（将资源名称转换为拼音）
     *
     * @param resource 资源对象
     * @return 表名（拼音格式）
     */
    private String getTableName(SsResource resource) {
        String resourceName = resource.getResourceName();
        if (resourceName == null || resourceName.isEmpty()) {
            return resourceName;
        }
        // 将中文转换为拼音
        return convertToPinyin(resourceName) + resource.getResourceId();
    }

    /**
     * 将中文转换为拼音 中文字符转换为拼音，非中文字符保持不变
     *
     * @param chinese 中文字符串
     * @return 拼音字符串
     */
    private String convertToPinyin(String chinese) {
        if (chinese == null || chinese.isEmpty()) {
            return chinese;
        }

        HanyuPinyinOutputFormat format = new HanyuPinyinOutputFormat();
        format.setCaseType(HanyuPinyinCaseType.LOWERCASE);
        format.setToneType(HanyuPinyinToneType.WITHOUT_TONE);

        StringBuilder result = new StringBuilder();

        try {
            for (char c : chinese.toCharArray()) {
                // 判断是否为中文字符
                if (Character.toString(c).matches("[\\u4E00-\\u9FA5]+")) {
                    // 是中文字符，转换为拼音
                    String[] pinyinArray = PinyinHelper.toHanyuPinyinStringArray(c, format);
                    if (pinyinArray != null && pinyinArray.length > 0) {
                        result.append(pinyinArray[0]);
                    }
                }
                else {
                    // 非中文字符，直接保留（包括字母、数字、下划线等）
                    result.append(c);
                }
            }
        }
        catch (BadHanyuPinyinOutputFormatCombination e) {
            logger.error("拼音转换失败：{}", e.getMessage(), e);
            // 转换失败时返回原字符串
            return chinese;
        }

        return result.toString();
    }

    /**
     * 转换数据类型（用于创建表） 支持的字段类型：String、Integer、Time、Number、Boolean、Text
     *
     * @param type 前端传入的数据类型
     * @return 数据库数据类型
     */
    private String convertDataTypeForCreate(String type) {
        if (type == null) {
            return "String";
        }
        // 根据接口文档，支持的字段类型：String、Integer、Time、Number、Boolean、Text
        switch (type.toUpperCase()) {
            case "STRING":
                return "String";
            case "INTEGER":
                return "Integer";
            case "TIME":
            case "DATE":
            case "DATETIME":
                return "Time";
            case "NUMBER":
            case "DECIMAL":
            case "DOUBLE":
            case "FLOAT":
                return "Number";
            case "BOOLEAN":
            case "BOOL":
                return "Boolean";
            case "TEXT":
            case "ARRAY":
            case "OBJECT":
                return "Text";
            case "ENUM":
                return "String";
            default:
                return "String";
        }
    }

    public Map<String, Object> saveOntologyActionInfos(@Valid OntologyActionSaveRequest request) {
        Map<String, Object> res = new HashMap<>();
        // 保存对象的动作及动作的属性数据、动作的关联数据
        List<OntologyBatchSaveRequest.ActionInfo> actionInfos = ontologyService.saveOntologyActions(request);
        res.put("resourceId", request.getResourceId());
        res.put("actionInfos", actionInfos);
        return res;
    }

    /**
     * 从pluginMachineInfo中提取工具参数 从pluginMachineOpenAPI的requestBody和responses中提取参数信息
     * 支持多种HTTP方法：GET、POST、PUT、DELETE、PATCH等
     *
     * @param pluginMachineInfoItem pluginMachineInfo项
     * @return 工具参数列表
     */
    private List<ToolParam> extractToolParams(Map<String, Object> pluginMachineInfoItem) {
        List<ToolParam> toolParams = new ArrayList<>();

        // 1. 获取pluginMachineOpenAPI对象
        Object pluginMachineOpenAPIObj = pluginMachineInfoItem.get("pluginMachineOpenAPI");
        if (!(pluginMachineOpenAPIObj instanceof Map)) {
            return toolParams;
        }
        Map<String, Object> pluginMachineOpenAPI = (Map<String, Object>) pluginMachineOpenAPIObj;

        // 2. 获取paths对象
        Object pathsObj = pluginMachineOpenAPI.get("paths");
        if (!(pathsObj instanceof Map)) {
            return toolParams;
        }
        Map<String, Object> paths = (Map<String, Object>) pathsObj;

        // 3. 遍历paths，获取第一个路径的操作（通常只有一个路径）
        for (Map.Entry<String, Object> pathEntry : paths.entrySet()) {
            Object pathValue = pathEntry.getValue();
            if (!(pathValue instanceof Map)) {
                continue;
            }
            Map<String, Object> pathOperations = (Map<String, Object>) pathValue;

            // 4. 支持的HTTP方法列表（按优先级顺序，找到第一个就处理）
            String[] httpMethods = {
                "post", "get", "put", "delete", "patch", "head", "options"
            };

            // 5. 遍历HTTP方法，找到第一个存在的操作
            for (String method : httpMethods) {
                Object operationObj = pathOperations.get(method);
                if (!(operationObj instanceof Map)) {
                    continue;
                }
                Map<String, Object> operation = (Map<String, Object>) operationObj;

                // 6. 提取入参（requestBody）- GET请求通常没有requestBody，会直接返回
                extractRequestBodyParams(operation, toolParams);

                // 7. 提取出参（responses）
                extractResponseParams(operation, toolParams);

                // 找到第一个有效的操作后，处理完就退出循环
                break;
            }
        }

        return toolParams;
    }

    /**
     * 提取请求体参数（入参）
     *
     * @param postOperation post操作对象
     * @param toolParams 参数列表
     */
    private void extractRequestBodyParams(Map<String, Object> postOperation, List<ToolParam> toolParams) {
        Object requestBodyObj = postOperation.get("requestBody");
        if (!(requestBodyObj instanceof Map)) {
            return;
        }
        Map<String, Object> requestBody = (Map<String, Object>) requestBodyObj;

        // 获取content
        Object contentObj = requestBody.get("content");
        if (!(contentObj instanceof Map)) {
            return;
        }
        Map<String, Object> content = (Map<String, Object>) contentObj;

        // 获取application/json
        Object applicationJsonObj = content.get("application/json");
        if (!(applicationJsonObj instanceof Map)) {
            return;
        }
        Map<String, Object> applicationJson = (Map<String, Object>) applicationJsonObj;

        // 获取schema
        Object schemaObj = applicationJson.get("schema");
        if (!(schemaObj instanceof Map)) {
            return;
        }
        Map<String, Object> schema = (Map<String, Object>) schemaObj;

        // 获取properties
        Object propertiesObj = schema.get("properties");
        if (!(propertiesObj instanceof Map)) {
            return;
        }
        Map<String, Object> properties = (Map<String, Object>) propertiesObj;

        // 获取required列表（从schema中提取顶层required）
        List<String> requiredList = extractRequiredList(schema);

        // 递归提取properties中的参数（入参：in_param）
        List<ToolParam> inputParams = extractProperties(properties, "in_param", requiredList);
        toolParams.addAll(inputParams);
    }

    /**
     * 提取响应参数（出参）
     *
     * @param postOperation post操作对象
     * @param toolParams 参数列表
     */
    private void extractResponseParams(Map<String, Object> postOperation, List<ToolParam> toolParams) {
        Object responsesObj = postOperation.get("responses");
        if (!(responsesObj instanceof Map)) {
            return;
        }
        Map<String, Object> responses = (Map<String, Object>) responsesObj;

        // 获取200响应
        Object response200Obj = responses.get("200");
        if (!(response200Obj instanceof Map)) {
            return;
        }
        Map<String, Object> response200 = (Map<String, Object>) response200Obj;

        // 获取content
        Object contentObj = response200.get("content");
        if (!(contentObj instanceof Map)) {
            return;
        }
        Map<String, Object> content = (Map<String, Object>) contentObj;

        // 获取application/json
        Object applicationJsonObj = content.get("application/json");
        if (!(applicationJsonObj instanceof Map)) {
            return;
        }
        Map<String, Object> applicationJson = (Map<String, Object>) applicationJsonObj;

        // 获取schema
        Object schemaObj = applicationJson.get("schema");
        if (!(schemaObj instanceof Map)) {
            return;
        }
        Map<String, Object> schema = (Map<String, Object>) schemaObj;

        // 获取properties
        Object propertiesObj = schema.get("properties");
        if (!(propertiesObj instanceof Map)) {
            return;
        }
        Map<String, Object> properties = (Map<String, Object>) propertiesObj;

        // 获取required列表（从schema中提取顶层required）
        List<String> requiredList = extractRequiredList(schema);

        // 递归提取properties中的参数（出参：out_param）
        List<ToolParam> outputParams = extractProperties(properties, "out_param", requiredList);
        toolParams.addAll(outputParams);
    }

    /**
     * 递归提取properties中的参数
     *
     * @param properties properties对象
     * @param paramType 参数类型：in_param或out_param
     * @param requiredList 必填字段列表（父级的required列表，用于设置当前层级的isRequired）
     * @return 参数列表
     */
    private List<ToolParam> extractProperties(Map<String, Object> properties, String paramType,
        List<String> requiredList) {
        List<ToolParam> params = new ArrayList<>();

        // 如果requiredList为null，初始化为空列表
        if (requiredList == null) {
            requiredList = new ArrayList<>();
        }

        for (Map.Entry<String, Object> entry : properties.entrySet()) {
            String paramCode = entry.getKey();
            Object paramValue = entry.getValue();

            if (!(paramValue instanceof Map)) {
                continue;
            }
            Map<String, Object> paramMap = (Map<String, Object>) paramValue;

            // 创建基础参数对象（使用父级的required列表设置isRequired）
            ToolParam toolParam = createBaseToolParam(paramCode, paramMap, paramType, requiredList);

            // 处理子属性：从当前参数的定义中提取required列表，用于设置子属性的isRequired
            List<ToolParam> children = extractChildrenParams(paramMap, paramType, toolParam);
            toolParam.setChildren(children.isEmpty() ? null : children);

            params.add(toolParam);
        }

        return params;
    }

    /**
     * 提取required列表
     *
     * @param parentMap 父对象Map（可能包含required字段）
     * @return required列表，如果不存在则返回空列表
     */
    private List<String> extractRequiredList(Map<String, Object> parentMap) {
        if (parentMap == null) {
            return new ArrayList<>();
        }

        Object requiredObj = parentMap.get("required");
        if (requiredObj == null) {
            return new ArrayList<>();
        }

        List<String> requiredList = new ArrayList<>();
        if (requiredObj instanceof List) {
            for (Object item : (List<?>) requiredObj) {
                if (item != null) {
                    requiredList.add(item.toString());
                }
            }
        }

        return requiredList;
    }

    /**
     * 创建基础ToolParam对象
     *
     * @param paramCode 参数代码
     * @param paramMap 参数Map
     * @param paramType 参数类型
     * @param requiredList 必填字段列表
     * @return ToolParam对象
     */
    private ToolParam createBaseToolParam(String paramCode, Map<String, Object> paramMap, String paramType,
        List<String> requiredList) {
        ToolParam toolParam = new ToolParam();
        toolParam.setParamCode(paramCode);
        toolParam.setParamName(paramCode);
        toolParam.setParamDesc(MapUtils.getString(paramMap, "description"));
        toolParam.setParamType(paramType);
        toolParam.setType(MapUtils.getString(paramMap, "type"));
        toolParam.setParamDefault(MapUtils.getString(paramMap, "default"));

        // 判断是否必填：如果paramCode在requiredList中，则isRequired=1，否则为0或null
        if (requiredList != null && requiredList.contains(paramCode)) {
            toolParam.setIsRequired(1);
        }
        else {
            toolParam.setIsRequired(0);
        }

        // 提取术语信息（如果存在extensions）
        TermInfo termInfo = extractTermInfo(paramMap);
        toolParam.setTermInfo(termInfo);

        return toolParam;
    }

    /**
     * 提取术语信息 从extensions.x-term-info中提取术语相关信息
     *
     * @param paramMap 参数Map
     * @return TermInfo对象，如果不存在extensions则返回null
     */
    private TermInfo extractTermInfo(Map<String, Object> paramMap) {
        // 1. 获取extensions对象
        Object extensionsObj = paramMap.get("extensions");
        if (!(extensionsObj instanceof Map)) {
            return null;
        }
        Map<String, Object> extensions = (Map<String, Object>) extensionsObj;

        // 2. 获取x-term-info对象
        Object xTermInfoObj = extensions.get("x-term-info");
        if (!(xTermInfoObj instanceof Map)) {
            return null;
        }
        Map<String, Object> xTermInfo = (Map<String, Object>) xTermInfoObj;

        String termCodeOrName = MapUtils.getString(extensions, "x-rel-term-field");
        // 3. 构造TermInfo对象
        TermInfo termInfo = new TermInfo();
        termInfo.setDatasetId(MapUtils.getString(xTermInfo, "datasetId"));
        termInfo.setTermTypeCode(MapUtils.getString(xTermInfo, "termCode"));
        termInfo.setTermTypeId(MapUtils.getString(xTermInfo, "termId"));
        termInfo.setTermTypeName(MapUtils.getString(xTermInfo, "termName"));
        termInfo.setTermDataType(MapUtils.getString(xTermInfo, "termType"));
        termInfo.setTermField(termCodeOrName);
        String label = MapUtils.getString(xTermInfo, "label");
        if (StringUtils.isNotBlank(label)) {
            Map<String, Object> labelMap = JSONObject.parseObject(label);
            termInfo.setTermDataType(MapUtils.getString(labelMap, "termDataType"));
        }

        return termInfo;
    }

    /**
     * 提取子参数 从当前参数的定义中提取required列表，用于设置子属性的isRequired
     *
     * @param paramMap 参数Map
     * @param paramType 参数类型
     * @param toolParam 当前参数对象（用于设置subType）
     * @return 子参数列表
     */
    private List<ToolParam> extractChildrenParams(Map<String, Object> paramMap, String paramType, ToolParam toolParam) {
        List<ToolParam> children = new ArrayList<>();
        String dataType = MapUtils.getString(paramMap, "type");

        if ("object".equals(dataType)) {
            extractObjectChildren(paramMap, paramType, children);
        }
        else if ("array".equals(dataType)) {
            extractArrayChildren(paramMap, paramType, children, toolParam);
        }

        return children;
    }

    /**
     * 提取object类型的子参数 从当前参数的定义中提取required列表，用于设置子属性的isRequired
     *
     * @param paramMap 参数Map
     * @param paramType 参数类型
     * @param children 子参数列表（输出）
     */
    private void extractObjectChildren(Map<String, Object> paramMap, String paramType, List<ToolParam> children) {
        Object childrenPropertiesObj = paramMap.get("properties");
        if (childrenPropertiesObj instanceof Map) {
            Map<String, Object> childrenProperties = (Map<String, Object>) childrenPropertiesObj;
            // 从当前paramMap中提取required列表（这个required列表用于设置子属性的isRequired）
            List<String> childRequiredList = extractRequiredList(paramMap);
            children.addAll(extractProperties(childrenProperties, paramType, childRequiredList));
        }
    }

    /**
     * 提取array类型的子参数 如果items里面有properties，无论items的type是什么，都将properties提取为children 同时设置subType为items的type
     *
     * @param paramMap 参数Map
     * @param paramType 参数类型
     * @param children 子参数列表（输出）
     * @param toolParam 当前参数对象（用于设置subType）
     */
    private void extractArrayChildren(Map<String, Object> paramMap, String paramType, List<ToolParam> children,
        ToolParam toolParam) {
        Map<String, Object> items = MapUtils.getMap(paramMap, "items");
        if (null == items || MapUtils.isEmpty(items)) {
            return;
        }
        toolParam.setSubType(MapUtils.getString(items, "type"));
        // 如果items里面有properties，无论type是什么，都提取properties作为children
        Map<String, Object> itemsProperties = MapUtils.getMap(items, "properties");
        if (MapUtils.isNotEmpty(itemsProperties)) {
            // 从items中提取required列表（用于设置items子属性的isRequired）
            List<String> itemsRequiredList = extractRequiredList(items);
            children.addAll(extractProperties(itemsProperties, paramType, itemsRequiredList));
        }

    }

}
