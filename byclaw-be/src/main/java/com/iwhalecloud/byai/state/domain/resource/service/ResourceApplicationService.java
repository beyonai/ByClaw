package com.iwhalecloud.byai.state.domain.resource.service;

import static com.iwhalecloud.byai.state.domain.men.enums.SystemCodeEnum.SANDBOX;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.collections.MapUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.feign.request.manager.ResourceOperQo;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import com.iwhalecloud.byai.common.log.exception.KnowledgeRuntimeExcepion;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.common.vo.SortField;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.resource.ResourceQueryRequest;
import com.iwhalecloud.byai.manager.dto.resource.SsResourceRelDetailDTO;
import com.iwhalecloud.byai.manager.entity.men.MenTaskCatalog;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.men.MenTaskCatalogMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDigEmployeeMapper;
import com.iwhalecloud.byai.state.domain.file.service.FileService;
import com.iwhalecloud.byai.state.domain.resource.qo.ResourceDetailQo;
import com.iwhalecloud.byai.state.domain.resource.vo.ResourceDetailVo;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.template.enums.DebugModeEnum;

@Service
public class ResourceApplicationService {

    public static final Logger LOGGER = LoggerFactory.getLogger(ResourceApplicationService.class);

    @Autowired
    private FileService fileService;

    @Autowired
    private MenTaskCatalogMapper menTaskCatalogMapper;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private SessionService sessionService;

    @Autowired
    private SandboxService sandboxService;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    @Autowired
    private SsResExtDigEmployeeMapper ssResExtDigEmployeeMapper;

    @Autowired
    private SsResourceRelDetailService ssResourceRelDetailService;

    @Autowired
    private ResManagementService resManagementService;

    private List<String> buildUploadTags(List<String> customTags, Long sessionId, String taskId, String taskCatalogId) {
        List<String> tags = new ArrayList<>();
        tags.add("US_" + CurrentUserHolder.getCurrentUserId());
        tags.add("SE_" + sessionId);
        if (StringUtils.isNotEmpty(taskId)) {
            tags.add("TA_" + taskId);
        }
        if (StringUtils.isNotEmpty(taskCatalogId)) {
            tags.addAll(generateCatalogLevelTags(Long.valueOf(taskCatalogId)));
        }
        if (CollectionUtils.isNotEmpty(customTags)) {
            tags.addAll(customTags);
        }
        tags.add("NET_0");
        return tags;
    }

    private void appendFilenameTags(Map<String, Object> resultObject) {
        if (resultObject == null) {
            return;
        }
        try {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> successFiles = (List<Map<String, Object>>) resultObject.get("successFiles");
            if (CollectionUtils.isEmpty(successFiles)) {
                return;
            }
            List<Map<String, Object>> fileTagsRequest = new ArrayList<>();
            for (Map<String, Object> fileInfo : successFiles) {
                String fileId = (String) fileInfo.get("fileId");
                String fileName = (String) fileInfo.get("fileName");
                if (StringUtils.isNotEmpty(fileId) && StringUtils.isNotEmpty(fileName)) {
                    Map<String, Object> fileTagMap = new HashMap<>();
                    fileTagMap.put("fileId", fileId);
                    fileTagMap.put("tags", "FN_" + fileName);
                    fileTagsRequest.add(fileTagMap);
                }
            }
            if (CollectionUtils.isEmpty(fileTagsRequest)) {
                return;
            }
            Map<String, Object> addTagsRequest = new HashMap<>();
            addTagsRequest.put("files", fileTagsRequest);
            LOGGER.info("为上传文件批量添加FN_标签, 请求参数: {}", JSONObject.toJSONString(addTagsRequest));
            KnowledgeResponse<List<Map<String, Object>>> addTagsResponse = fileService.addFileTagsBatch(addTagsRequest);
            if (!Constants.RESPONSE_SUCCESS.equals(addTagsResponse.getResultCode())) {
                LOGGER.info("批量添加文件标签失败: {}", addTagsResponse.getResultMsg());
                return;
            }
            LOGGER.info("成功为{}个文件添加FN_标签", fileTagsRequest.size());
            List<Map<String, Object>> updatedFiles = addTagsResponse.getResultObject();
            if (CollectionUtils.isNotEmpty(updatedFiles)) {
                resultObject.put("successFiles", updatedFiles);
                LOGGER.info("已更新响应结果中的successFiles，包含最新标签信息");
            }
        }
        catch (RuntimeException exception) {
            LOGGER.error("添加文件标签异常，但文件上传成功: {}", exception.getMessage(), exception);
        }
    }

    /**
     * 查询资源详情
     *
     * @param resourceDetailQo 包含resourceId的参数Map
     * @return ResponseUtil
     */
    public ResourceDetailVo queryResourceDetail(ResourceDetailQo resourceDetailQo) {

        Long resourceId = resourceDetailQo.getResourceId();
        String resourceCode = resourceDetailQo.getResourceCode();
        SsResource ssResource = ssResourceService.findByIdOrCode(resourceId, resourceCode);

        if (ssResource == null) {
            return null;
        }

        ResourceDetailVo resourceDetailVo = new ResourceDetailVo();
        BeanUtils.copyProperties(ssResource, resourceDetailVo);
        if (Constants.ResourceBizType.DIG_EMPLOYEE.equalsIgnoreCase(ssResource.getResourceBizType())) {
            SsResExtDigEmployee ssResExtDigEmployee = ssResExtDigEmployeeService.findById(ssResource.getResourceId());
            resourceDetailVo.setParam(ssResExtDigEmployee);
        }

        // 处理沙箱类型资源，替换agentHomeUrl为沙箱端点地址
        if (SANDBOX.getCode().equals(resourceDetailVo.getSystemCode())) {
            if (resourceId == null) {
                resourceId = ssResource.getResourceId();
            }
            Map<String, Object> param = null;
            Object paramObj = resourceDetailVo.getParam();
            if (paramObj != null) {
                param = MapParamUtil.objectToMap(paramObj);
            }
            if (resourceId != null && param != null) {
                sandboxService.processSandboxForResource(resourceId, resourceDetailVo.getSystemCode(), param);
                resourceDetailVo.setParam(param);
            }
        }

        return resourceDetailVo;

    }

    public ResponseUtil preUploadFile(String datasetId, String metadata, MultipartFile[] files) {
        return ResponseUtil.successResponse();
    }

    public Map<String, Object> getPageList(ResourceOperQo resourceQo) {
        List<SortField> sortFields = new ArrayList<>(List.of(createSortField("createTime", "desc", 1)));

        ResourceQueryRequest request = new ResourceQueryRequest();
        request.setSortFields(sortFields);
        request.setOwnershipType(3);
        // 已上架的
        request.setStatusList(List.of(2));

        KnowledgeResponse response = resManagementService.getResourceListByPage(request);
        if (!Constants.RESPONSE_SUCCESS.equals(response.getResultCode())) {
            throw new KnowledgeRuntimeExcepion(response.getResultMsg());
        }
        Map<String, Object> data = (Map<String, Object>) response.getResultObject();
        List<Map<String, Object>> rows = (List<Map<String, Object>>) MapUtils.getObject(data, "rows");

        List<Long> objIdList = new ArrayList<>();
        // // 根据objIdList查询授权数量
        List<SsResource> res = rows.stream().map(item -> {
            SsResource ssResource = new SsResource();
            ssResource.setResourceId(Long.valueOf(MapUtils.getString(item, "resourceId")));
            ssResource.setResourceDesc(MapUtils.getString(item, "resourceDesc"));
            ssResource.setCreateTime(setDate(MapUtils.getString(item, "createTime")));
            ssResource.setResourceName(MapUtils.getString(item, "resourceName"));
            ssResource.setUpdateTime(setDate(MapUtils.getString(item, "updateTime")));
            ssResource.setResourceBizType(MapUtils.getString(item, "resourceBizType"));
            ssResource.setResourceSourcePkId(MapUtils.getLong(item, "resourceSourcePkId"));
            ssResource.setResourceStatus(MapUtils.getInteger(item, "resourceStatus"));
            ssResource.setResourceCode(MapUtils.getString(item, "resourceCode"));
            objIdList.add(ssResource.getResourceId());
            return ssResource;
        }).collect(Collectors.toList());

        return buildResMap(data, res);

    }

    private static SortField createSortField(String field, String order, int priority) {
        SortField sf = new SortField();
        sf.setField(field);
        sf.setOrder(order);
        sf.setPriority(priority);
        return sf;
    }

    /**
     * 优化：使用更高效的Map构建方式，减少MapUtils调用开销
     */
    private Map<String, Object> buildResMap(Map<String, Object> map, List<SsResource> data) {
        // 优化：预先计算容量，避免HashMap扩容
        Map<String, Object> resMap = new HashMap<>(4);
        resMap.put("rows", data);

        // 优化：直接从map中获取值，减少MapUtils的反射开销
        Object pageIndex = map.get("pageIndex");
        Object pageSize = map.get("pageSize");
        Object total = map.get("total");
        Object totalPage = map.get("totalPage");

        // 优化：使用Map.of创建不可变map，性能更好
        Map<String, Object> pageInfo = Map.of("pageNum", pageIndex != null ? pageIndex : 0L, "pageSize",
            pageSize != null ? pageSize : 0L, "total", total != null ? total : 0L, "totalPages",
            totalPage != null ? totalPage : 0L);

        resMap.put("pageInfo", pageInfo);
        return resMap;
    }

    private Date setDate(String createTimeStr) {
        try {
            // 假设日期格式为 "yyyy-MM-dd HH:mm:ss"，请根据实际情况调整
            DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
            LocalDateTime localDateTime = LocalDateTime.parse(createTimeStr, formatter);
            return Date.from(localDateTime.atZone(ZoneId.systemDefault()).toInstant());

        }
        catch (Exception e) {
            // 处理日期解析异常
            LOGGER.error("Failed to parse date: " + createTimeStr, e);
            return null; // 或者抛出异常，取决于你的错误处理策略
        }
    }

    /**
     * 上传文件到指定会话
     *
     * @param sessionId 会话ID
     * @param files 上传的文件数组
     * @param isTemporary 是否为临时文件
     * @return ResponseUtil
     */
    public ResponseUtil uploadSessionFiles(MultipartFile[] files, List<String> customTags, Long sessionId,
        String taskId, String taskCatalogId, Boolean isTemporary) {
        try {
            List<String> tags = buildUploadTags(customTags, sessionId, taskId, taskCatalogId);

            Long projectId = Long
                .parseLong(byaiSystemConfigService.getDcSystemConfigValueByCode(Constants.AGENT_RESOURCE_PROJECT_ID));

            KnowledgeResponse<Map<String, Object>> response = fileService.uploadFiles(files, tags, sessionId, projectId,
                isTemporary);
            if (!Constants.RESPONSE_SUCCESS.equals(response.getResultCode())) {
                throw new KnowledgeRuntimeExcepion(response.getResultMsg());
            }

            appendFilenameTags(response.getResultObject());
            return ResponseUtil.successResponse(response.getResultObject());
        }
        catch (RuntimeException e) {
            LOGGER.error("feign knowledge api/sessions/{}/files upload error!", e.getMessage());
            throw new KnowledgeRuntimeExcepion(e);
        }
    }

    /**
     * 在指定会话下，根据标签查询匹配的文件
     *
     * @param sessionId 会话ID
     * @param taskId 任务ID
     * @param matchMode 匹配模式 any/all，默认all
     * @param fileName 文件名过滤（可选）
     * @return ResponseUtil
     */
    public ResponseUtil<Map<String, Object>> searchFilesByTags(String sessionId, String taskId, String matchMode,
        String fileName) {
        try {
            ResponseUtil<Map<String, Object>> validation = validateSearchParameters(sessionId);
            if (validation != null) {
                return validation;
            }
            String normalizedMatchMode = StringUtils.isBlank(matchMode) ? "all" : matchMode;

            ByaiSession session = sessionService.findById(Long.valueOf(sessionId));
            if (Objects.isNull(session)) {
                return ResponseUtil.fail("会话不存在");
            }

            List<String> tagList = buildSearchTags(session, sessionId, taskId);
            Map<String, Object> request = buildSearchRequest(sessionId, normalizedMatchMode, tagList);

            KnowledgeResponse<Map<String, Object>> response = fileService.searchFilesByTags(request);
            if (!Constants.RESPONSE_SUCCESS.equals(response.getResultCode())) {
                throw new KnowledgeRuntimeExcepion(response.getResultMsg());
            }

            Map<String, Object> resultObject = response.getResultObject();
            filterFilesByName(resultObject, fileName);
            return ResponseUtil.successResponse(resultObject);
        }
        catch (RuntimeException e) {
            LOGGER.error("feign knowledge api/sessions/{}/files/search error!", e.getMessage());
            throw new KnowledgeRuntimeExcepion(e);
        }
    }

    private ResponseUtil<Map<String, Object>> validateSearchParameters(String sessionId) {
        if (StringUtils.isBlank(sessionId)) {
            return ResponseUtil.fail("会话ID不能为空");
        }
        return null;
    }

    private List<String> buildSearchTags(ByaiSession session, String sessionId, String taskId) {
        List<String> tagList = new ArrayList<>();
        if (!DebugModeEnum.DEBUG_2.getNum().equals(session.getIsDebug())) {
            tagList.add("US_" + CurrentUserHolder.getCurrentUserId());
        }
        tagList.add("SE_" + sessionId);
        if (StringUtils.isNotBlank(taskId)) {
            tagList.add("TA_" + taskId);
        }
        return tagList;
    }

    private Map<String, Object> buildSearchRequest(String sessionId, String matchMode, List<String> tagList) {
        Map<String, Object> request = new HashMap<>();
        request.put("chatId", sessionId);
        request.put("tags", String.join(",", tagList));
        request.put("matchMode", matchMode);
        return request;
    }

    private void filterFilesByName(Map<String, Object> resultObject, String fileName) {
        if (StringUtils.isBlank(fileName) || resultObject == null) {
            return;
        }
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> files = (List<Map<String, Object>>) resultObject.get("files");
        if (files == null) {
            return;
        }
        List<Map<String, Object>> filteredFiles = files.stream().filter(file -> {
            String fileNameInResult = (String) file.get("fileName");
            return fileNameInResult != null && fileNameInResult.toLowerCase().contains(fileName.toLowerCase());
        }).collect(Collectors.toList());
        resultObject.put("files", filteredFiles);
    }

    /**
     * 递归删除目录及其下的所有子目录和文件
     *
     * @param taskCatalogId 目录ID
     * @param sessionId 会话ID
     * @param taskId 任务ID
     * @return ResponseUtil
     */
    private ResponseUtil deleteCatalogRecursively(Long taskCatalogId, String sessionId, Long taskId) {
        try {
            // 1. 查找当前目录下的所有子目录
            List<Long> subCatalogIds = findSubCatalogIds(taskCatalogId);

            // 2. 递归删除子目录
            for (Long subCatalogId : subCatalogIds) {
                ResponseUtil subDeleteResult = deleteCatalogRecursively(subCatalogId, sessionId, taskId);
                if (!Constants.RESPONSE_SUCCESS.equals(subDeleteResult.getResultCode())) {
                    return subDeleteResult;
                }
            }

            // 3. 删除当前目录下的所有文件
            ResponseUtil fileDeleteResult = deleteCatalogFiles(taskCatalogId, sessionId, taskId);
            if (!Constants.RESPONSE_SUCCESS.equals(fileDeleteResult.getResultCode())) {
                return fileDeleteResult;
            }

            // 4. 删除当前目录
            int result = menTaskCatalogMapper.deleteById(taskCatalogId);
            if (result <= 0) {
                return ResponseUtil.fail("删除目录" + taskCatalogId + "失败");
            }

            return ResponseUtil.successResponse("删除目录" + taskCatalogId + "成功");
        }
        catch (Exception e) {
            LOGGER.error("递归删除目录异常, catalogId: {}", taskCatalogId, e);
            return ResponseUtil.fail("递归删除目录异常: " + e.getMessage());
        }
    }

    /**
     * 查找指定目录下的所有子目录ID
     *
     * @param parentCatalogId 父目录ID
     * @return 子目录ID列表
     */
    private List<Long> findSubCatalogIds(Long parentCatalogId) {
        List<Long> subCatalogIds = new ArrayList<>();
        try {
            LambdaQueryWrapper<MenTaskCatalog> queryWrapper = new LambdaQueryWrapper<>();
            queryWrapper.eq(MenTaskCatalog::getPCatalogId, String.valueOf(parentCatalogId));
            List<MenTaskCatalog> subCatalogs = menTaskCatalogMapper.selectList(queryWrapper);
            if (CollectionUtils.isNotEmpty(subCatalogs)) {
                subCatalogIds = subCatalogs.stream().map(MenTaskCatalog::getTaskCatalogId).collect(Collectors.toList());
            }
        }
        catch (Exception e) {
            LOGGER.error("查找子目录异常, parentCatalogId: {}", parentCatalogId, e);
        }
        return subCatalogIds;
    }

    /**
     * 删除指定目录下的所有文件
     *
     * @param taskCatalogId 目录ID
     * @param sessionId 会话ID
     * @param taskId 任务ID
     * @return ResponseUtil
     */
    private ResponseUtil deleteCatalogFiles(Long taskCatalogId, String sessionId, Long taskId) {
        try {
            // 生成目录层级标签：TC1_目录名、TC2_目录名等
            List<String> catalogLevelTags = generateCatalogLevelTags(taskCatalogId);

            // 构建标签列表
            String userTag = "US_" + CurrentUserHolder.getCurrentUserId();
            String sessionTag = "SE_" + sessionId;
            String taskTag = "TA_" + taskId;

            List<String> tagList = new ArrayList<>();
            tagList.add(userTag);
            tagList.add(sessionTag);
            tagList.add(taskTag);
            tagList.addAll(catalogLevelTags);

            String tags = String.join(",", tagList);

            // 构建请求参数
            Map<String, Object> searchRequest = new HashMap<>();
            searchRequest.put("chatId", sessionId);
            searchRequest.put("tags", tags);
            searchRequest.put("matchMode", "all");

            // 查找关联文件
            KnowledgeResponse<Map<String, Object>> searchResponse = fileService.searchFilesByTags(searchRequest);

            if (Constants.RESPONSE_SUCCESS.equals(searchResponse.getResultCode())
                && searchResponse.getResultObject() != null) {

                Map<String, Object> searchResult = searchResponse.getResultObject();
                List<Map<String, Object>> files = (List<Map<String, Object>>) searchResult.get("files");

                // 如果找到关联文件，删除这些文件
                if (CollectionUtils.isNotEmpty(files)) {
                    List<String> fileIds = files.stream().map(file -> (String) file.get("fileId"))
                        .filter(Objects::nonNull).collect(Collectors.toList());

                    if (CollectionUtils.isNotEmpty(fileIds)) {
                        Map<String, Object> deleteRequest = new HashMap<>();
                        deleteRequest.put("fileIds", fileIds);
                        LOGGER.info("成功删除目录{}下的{}个文件", taskCatalogId, fileIds.size());
                    }
                }
            }

            return ResponseUtil.successResponse("删除目录" + taskCatalogId + "下的文件成功");
        }
        catch (Exception e) {
            LOGGER.error("删除目录文件异常, catalogId: {}", taskCatalogId, e);
            return ResponseUtil.fail("删除目录" + taskCatalogId + "下的文件时发生异常: " + e.getMessage());
        }
    }

    /**
     * 根据任务ID查询目录列表
     *
     * @param taskId 任务ID
     * @return ResponseUtil
     */
    public ResponseUtil getCatalogsByTaskId(Long taskId) {
        try {
            if (taskId == null) {
                return ResponseUtil.fail("任务ID不能为空");
            }
            LambdaQueryWrapper<MenTaskCatalog> queryWrapper = new LambdaQueryWrapper<>();
            queryWrapper.eq(MenTaskCatalog::getTaskId, taskId);
            queryWrapper.orderByDesc(MenTaskCatalog::getCreateTime);
            List<MenTaskCatalog> catalogs = menTaskCatalogMapper.selectList(queryWrapper);
            return ResponseUtil.successResponse(catalogs);
        }
        catch (Exception e) {
            return ResponseUtil.fail("查询目录异常: " + e.getMessage());
        }
    }

    /**
     * 根据任务ID和目录名称查找目录ID
     *
     * @param taskId 任务ID
     * @param catalogName 目录名称
     * @return 目录ID，如果未找到返回null
     */
    public Long getCatalogIdByTaskIdAndName(Long taskId, String catalogName) {
        try {
            if (taskId == null || StringUtils.isBlank(catalogName)) {
                return null;
            }

            LambdaQueryWrapper<MenTaskCatalog> queryWrapper = new LambdaQueryWrapper<>();
            queryWrapper.eq(MenTaskCatalog::getTaskId, taskId);
            queryWrapper.eq(MenTaskCatalog::getCataName, catalogName);
            List<MenTaskCatalog> catalogs = menTaskCatalogMapper.selectList(queryWrapper);
            if (catalogs != null && !catalogs.isEmpty()) {
                return catalogs.get(0).getTaskCatalogId();
            }
            return null;
        }
        catch (Exception e) {
            return null;
        }
    }

    /**
     * 计算目录层级并生成相应的标签 根据目录的层级关系生成TC1_、TC2_等标签
     *
     * @param taskCatalogId 目录ID
     * @return 目录层级标签列表
     */
    public List<String> generateCatalogLevelTags(Long taskCatalogId) {
        List<String> catalogTags = new ArrayList<>();

        if (taskCatalogId == null) {
            return catalogTags;
        }

        try {
            // 首先计算目录的总层级数
            int totalLevels = calculateTotalLevels(taskCatalogId);

            // 从当前目录开始，向上遍历父目录，构建层级路径
            Long currentCatalogId = taskCatalogId;
            int currentLevel = totalLevels; // 从最大层级开始

            while (currentCatalogId != null && currentCatalogId > 0) {
                MenTaskCatalog catalog = menTaskCatalogMapper.selectById(currentCatalogId);
                if (catalog == null) {
                    break;
                }

                // 生成当前层级的标签：TC1_目录名、TC2_目录名等
                String levelTag = "TC" + currentLevel + "_" + catalog.getCataName();
                catalogTags.add(0, levelTag); // 插入到列表开头，保持层级顺序

                // 获取父目录ID
                String parentCatalogIdStr = catalog.getPCatalogId();
                if (StringUtils.isBlank(parentCatalogIdStr) || "-1".equals(parentCatalogIdStr)) {
                    // 到达根目录，结束遍历
                    break;
                }

                try {
                    currentCatalogId = Long.valueOf(parentCatalogIdStr);
                    currentLevel--; // 向上遍历时层级递减
                }
                catch (NumberFormatException e) {
                    LOGGER.warn("Invalid parent catalog ID: {}", parentCatalogIdStr);
                    break;
                }
            }
        }
        catch (Exception e) {
            LOGGER.error("Error generating catalog level tags for catalog ID: {}", taskCatalogId, e);
        }

        return catalogTags;
    }

    /**
     * 计算目录的总层级数 从当前目录向上遍历到根目录，计算总层级数
     *
     * @param taskCatalogId 目录ID
     * @return 总层级数
     */
    private int calculateTotalLevels(Long taskCatalogId) {
        int levels = 0;
        Long currentCatalogId = taskCatalogId;

        while (currentCatalogId != null && currentCatalogId > 0) {
            levels++;
            MenTaskCatalog catalog = menTaskCatalogMapper.selectById(currentCatalogId);
            if (catalog == null) {
                break;
            }

            String parentCatalogIdStr = catalog.getPCatalogId();
            if (StringUtils.isBlank(parentCatalogIdStr) || "-1".equals(parentCatalogIdStr)) {
                break;
            }

            try {
                currentCatalogId = Long.valueOf(parentCatalogIdStr);
            }
            catch (NumberFormatException e) {
                LOGGER.warn("Invalid parent catalog ID: {}", parentCatalogIdStr);
                break;
            }
        }

        return levels;
    }

    // ==================== 数字员工 OpenAPI（免登录） ====================

    /**
     * 数字员工列表查询（免登录） 根据数字员工类型和名称模糊查询已上架的数字员工列表
     *
     * @param agentType 数字员工类型（001-助手、005-问答、006-问数），可空
     * @param resourceName 数字员工名称（模糊查询），可空
     * @return 数字员工详情列表
     */
    public List<DigitalEmployeeDetailsDTO> queryDigEmployeeListForOpenApi(String agentType, String resourceName) {
        String nameKw = StringUtils.isBlank(resourceName) ? null : resourceName.trim();
        String typeParam = StringUtils.isBlank(agentType) ? null : agentType.trim();
        return ssResExtDigEmployeeMapper.findDigEmployeeListForOpenApi(typeParam, nameKw);
    }

    /**
     * 数字员工详情查询（免登录） 根据数字员工ID查询详情信息
     *
     * @param resourceId 数字员工ID
     * @return 数字员工详情
     */
    public DigitalEmployeeDetailsDTO queryDigEmployeeDetailForOpenApi(Long resourceId) {
        if (resourceId == null) {
            return null;
        }
        return ssResExtDigEmployeeService.findDetailsById(resourceId);
    }

    /**
     * 数字员工技能查询（免登录） 根据数字员工ID查询其关联的技能列表，可按技能类型过滤 根据 relResourceBizType 填充对应子表扩展数据
     *
     * @param resourceId 数字员工ID
     * @param resourceBizType 技能类型（可空），如 TOOLKIT、TOOL、KG_DOC、KG_DB、KG_TERM、KG_QA 等
     * @return 技能（关联资源）列表
     */
    public List<SsResourceRelDetailDTO> queryDigEmployeeSkillsForOpenApi(Long resourceId, String resourceBizType) {
        if (resourceId == null) {
            return new ArrayList<>();
        }
        List<SsResourceRelDetailDTO> allSkills = ssResourceRelDetailService.querySkillsForOpenApi(resourceId);

        if (StringUtils.isNotBlank(resourceBizType)) {
            String normalizedType = resourceBizType.trim();
            allSkills = allSkills.stream()
                .filter(skill -> StringUtils.equalsIgnoreCase(normalizedType, skill.getResourceBizType()))
                .collect(Collectors.toList());
        }
        return allSkills;
    }
}
