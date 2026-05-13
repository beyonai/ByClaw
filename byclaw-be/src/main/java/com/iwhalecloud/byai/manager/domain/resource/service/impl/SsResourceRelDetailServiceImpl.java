package com.iwhalecloud.byai.manager.domain.resource.service.impl;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;
import com.iwhalecloud.byai.manager.dto.resource.SaveViewResourceRelRequest;
import com.iwhalecloud.byai.manager.dto.resource.SsResourceRelDetailDTO;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtAttribute;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDbDataset;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDoc;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtTool;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtToolKit;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtAttributeMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDbDatasetMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDocMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtToolKitMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtToolMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceRelDetailMapper;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtAttributeMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceRelDetailMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.exception.ByAiArgumentException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 资源关联明细表Service实现类
 */
@Service
public class SsResourceRelDetailServiceImpl extends ServiceImpl<SsResourceRelDetailMapper, SsResourceRelDetail>
    implements SsResourceRelDetailService {

    private static final Logger logger = LoggerFactory.getLogger(SsResourceRelDetailServiceImpl.class);


    @Autowired
    private SsResourceRelDetailMapper ssResourceRelDetailMapper;

    @Autowired
    private SsResExtAttributeMapper ssResExtAttributeMapper;

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private SsResExtDocMapper ssResExtDocMapper;

    @Autowired
    private SsResExtToolMapper ssResExtToolMapper;

    @Autowired
    private SsResExtToolKitMapper ssResExtToolKitMapper;

    @Autowired
    private SsResExtDbDatasetMapper ssResExtDbDatasetMapper;

    private static final String RESOURCE_BIZ_TYPE_VIEW = "VIEW";

    private static final String RESOURCE_BIZ_TYPE_OBJECT = "OBJECT";

    private static final String ATTRIBUTE_TYPE_OUT_PARAM = "out_param";

    /** 数据分析型资源类型，用关联 ACTION 的 out_param */
    private static final String RESOURCE_TYPE_DB_TABLE = "DB_TABLE";

    private static final String RESOURCE_BIZ_TYPE_ACTION = "ACTION";

    private static final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 查询关联资源
     *
     * @param resourceId 资源标识
     * @return List<SsResourceRelDetail>
     */
    @Override
    public List<SsResourceRelDetail> findByResourceId(Long resourceId) {
        LambdaQueryWrapper<SsResourceRelDetail> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResourceRelDetail::getResourceId, resourceId);
        return ssResourceRelDetailMapper.selectList(queryWrapper);
    }

    /**
     * 校验视图资源是否存在
     *
     * @param resourceId 视图的resourceId
     * @throws ByAiArgumentException 如果视图资源不存在或参数不合法
     */
    private void validateViewResource(Long resourceId) {
        if (resourceId == null) {
            throw new ByAiArgumentException(I18nUtil.get("resource.rel.detail.view.resource.id.not.empty"));
        }
        SsResource viewResource = ssResourceMapper.selectById(resourceId);
        if (viewResource == null) {
            throw new ByAiArgumentException(I18nUtil.get("resource.rel.detail.view.resource.not.exist"));
        }
    }

    /**
     * 校验主对象资源是否存在
     *
     * @param activeResourceId 主对象ID
     * @throws ByAiArgumentException 如果主对象资源不存在或参数不合法
     */
    private void validateActiveResource(Long activeResourceId) {
        if (activeResourceId == null) {
            throw new ByAiArgumentException(I18nUtil.get("resource.rel.detail.active.resource.id.not.empty"));
        }
        SsResource activeResource = ssResourceMapper.selectById(activeResourceId);
        if (activeResource == null) {
            throw new ByAiArgumentException(I18nUtil.get("resource.rel.detail.active.resource.not.exist"));
        }
    }

    /**
     * 删除视图的所有关联关系
     *
     * @param resourceId 视图的resourceId
     */
    private void deleteViewResourceRelations(Long resourceId) {
        ssResourceRelDetailMapper.deleteByViewResourceId(resourceId);
        logger.info("删除视图的所有关联关系。viewResourceId: {}", resourceId);
    }

    /**
     * 构建资源名称映射表
     *
     * @param activeResourceId 主对象ID
     * @param relResourceInfoList 从对象关系列表
     * @return resourceId -> resourceName 映射
     */
    private Map<Long, String> buildResourceNameMap(Long activeResourceId,
        List<SaveViewResourceRelRequest.RelResourceInfo> relResourceInfoList) {
        // 收集所有需要查询的资源ID
        Set<Long> resourceIdsToQuery = collectResourceIds(activeResourceId, relResourceInfoList);

        // 批量查询资源信息
        Map<Long, String> resourceNameMap = new HashMap<>();
        if (!resourceIdsToQuery.isEmpty()) {
            List<SsResource> resources = ssResourceMapper.selectBatchIds(resourceIdsToQuery);
            if (CollectionUtils.isNotEmpty(resources)) {
                resourceNameMap = resources.stream()
                    .filter(resource -> resource != null && resource.getResourceId() != null)
                    .collect(Collectors.toMap(SsResource::getResourceId,
                        resource -> StringUtils.isNotBlank(resource.getResourceName()) ? resource.getResourceName()
                            : String.valueOf(resource.getResourceId())));
            }
        }
        return resourceNameMap;
    }

    /**
     * 收集所有需要查询的资源ID
     *
     * @param activeResourceId 主对象ID
     * @param relResourceInfoList 从对象关系列表
     * @return 资源ID集合
     */
    private Set<Long> collectResourceIds(Long activeResourceId,
        List<SaveViewResourceRelRequest.RelResourceInfo> relResourceInfoList) {
        Set<Long> resourceIdsToQuery = new java.util.HashSet<>();
        resourceIdsToQuery.add(activeResourceId);
        for (SaveViewResourceRelRequest.RelResourceInfo relInfo : relResourceInfoList) {
            Long relResourceId = relInfo.getRelResourceId();
            if (relResourceId != null) {
                resourceIdsToQuery.add(relResourceId);
            }
        }
        return resourceIdsToQuery;
    }

    /**
     * 构建需要保存的关系列表
     *
     * @param resourceId 视图的resourceId
     * @param activeResourceId 主对象ID
     * @param activeResourceName 主对象名称
     * @param relResourceInfoList 从对象关系列表
     * @param resourceNameMap 资源名称映射表
     * @return 关系列表
     */
    private List<SsResourceRelDetail> buildRelationsList(Long resourceId, Long activeResourceId,
        String activeResourceName, List<SaveViewResourceRelRequest.RelResourceInfo> relResourceInfoList,
        Map<Long, String> resourceNameMap) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        Long enterpriseId = CurrentUserHolder.getEnterpriseId();
        Date currentTime = new Date();
        List<SsResourceRelDetail> relations = new ArrayList<>();

        // 判断是否只有主对象（没有从对象）
        boolean hasOnlyActiveResource = CollectionUtils.isEmpty(relResourceInfoList);

        // 1. 视图-主关系
        // 如果只有主对象，relTypeName 设置为主对象名称；否则为 null
        String relTypeNameForViewToActive = hasOnlyActiveResource ? activeResourceName : null;
        addViewToActiveRelation(resourceId, activeResourceId, relTypeNameForViewToActive, currentUserId, enterpriseId,
            currentTime, relations);

        // 2. 如果有从对象，添加主-从关系 和 视图-从关系
        if (!hasOnlyActiveResource) {
            addActiveToRelRelations(resourceId, activeResourceId, activeResourceName, relResourceInfoList,
                resourceNameMap, currentUserId, enterpriseId, currentTime, relations);
        }

        return relations;
    }

    /**
     * 添加视图-主关系
     *
     * @param resourceId 视图的resourceId
     * @param activeResourceId 主对象ID
     * @param relTypeName 关联类型名称（当只有主对象时，为主对象名称；否则为 null）
     * @param currentUserId 当前用户ID
     * @param enterpriseId 企业ID
     * @param currentTime 当前时间
     * @param relations 关系列表
     */
    private void addViewToActiveRelation(Long resourceId, Long activeResourceId, String relTypeName, Long currentUserId,
        Long enterpriseId, Date currentTime, List<SsResourceRelDetail> relations) {
        String viewToActiveInfo = buildRelResourceInfoJson(resourceId, null);
        SsResourceRelDetail viewToActive = createRelation(resourceId, activeResourceId, relTypeName, viewToActiveInfo,
            currentUserId, enterpriseId, currentTime);
        relations.add(viewToActive);
    }

    /**
     * 添加主-从关系和视图-从关系
     *
     * @param resourceId 视图的resourceId
     * @param activeResourceId 主对象ID
     * @param activeResourceName 主对象名称
     * @param relResourceInfoList 从对象关系列表
     * @param resourceNameMap 资源名称映射表
     * @param currentUserId 当前用户ID
     * @param enterpriseId 企业ID
     * @param currentTime 当前时间
     * @param relations 关系列表
     */
    private void addActiveToRelRelations(Long resourceId, Long activeResourceId, String activeResourceName,
        List<SaveViewResourceRelRequest.RelResourceInfo> relResourceInfoList, Map<Long, String> resourceNameMap,
        Long currentUserId, Long enterpriseId, Date currentTime, List<SsResourceRelDetail> relations) {
        for (SaveViewResourceRelRequest.RelResourceInfo relInfo : relResourceInfoList) {
            Long relResourceId = relInfo.getRelResourceId();
            if (relResourceId == null) {
                continue;
            }

            // 获取从对象的资源名称
            String relResourceName = resourceNameMap.getOrDefault(relResourceId, String.valueOf(relResourceId));

            // 构建主-从关系的 relResourceInfo JSON
            String activeToRelInfo = buildRelResourceInfoJson(resourceId, relInfo.getRelResourceInfo());

            // 主-从关系（设置 relTypeName 为 主名称:从名称）
            String relTypeName = activeResourceName + ":" + relResourceName;
            SsResourceRelDetail activeToRel = createRelation(activeResourceId, relResourceId, relTypeName,
                activeToRelInfo, currentUserId, enterpriseId, currentTime);
            relations.add(activeToRel);

            // 构建视图-从关系的 relResourceInfo JSON
            String viewToRelInfo = buildRelResourceInfoJson(resourceId, relInfo.getRelResourceInfo());

            // 视图-从关系
            SsResourceRelDetail viewToRel = createRelation(resourceId, relResourceId, null, viewToRelInfo,
                currentUserId, enterpriseId, currentTime);
            relations.add(viewToRel);
        }
    }

    /**
     * 构建 relResourceInfo JSON 字符串 包含 viewResourceId 和前端传递的字段信息
     *
     * @param viewResourceId 视图资源ID
     * @param frontendInfo 前端传递的字段信息（JSON字符串）
     * @return JSON字符串
     */
    private String buildRelResourceInfoJson(Long viewResourceId, String frontendInfo) {
        try {
            Map<String, Object> infoMap = new HashMap<>();
            // 添加 viewResourceId
            infoMap.put("viewResourceId", viewResourceId);

            // 如果前端传递了字段信息，解析并合并
            if (StringUtils.isNotBlank(frontendInfo)) {
                try {
                    Map<String, Object> frontendMap = objectMapper.readValue(frontendInfo, Map.class);
                    if (frontendMap != null) {
                        infoMap.putAll(frontendMap);
                    }
                }
                catch (JsonProcessingException e) {
                    // 如果解析失败，将原始字符串作为字段存储
                    logger.debug("解析前端传递的relResourceInfo失败，将作为原始字符串存储。frontendInfo: {}", frontendInfo);
                    infoMap.put("frontendInfo", frontendInfo);
                }
            }

            return objectMapper.writeValueAsString(infoMap);
        }
        catch (Exception e) {
            logger.error("构建relResourceInfo JSON失败", e);
            // 如果构建失败，返回包含viewResourceId的最小JSON
            return "{\"viewResourceId\":" + viewResourceId + "}";
        }
    }

    /**
     * 创建关联关系对象
     */
    private SsResourceRelDetail createRelation(Long resourceId, Long relResourceId, String relTypeName,
        String relResourceInfo, Long currentUserId, Long enterpriseId, Date currentTime) {
        SsResourceRelDetail relDetail = new SsResourceRelDetail();
        relDetail.setResourceRelDetailId(SequenceService.nextVal());
        relDetail.setResourceId(resourceId);
        relDetail.setRelResourceId(relResourceId);
        relDetail.setRelTypeName(relTypeName);
        relDetail.setRelStatus(1); // 默认开启
        relDetail.setRelResourceInfo(relResourceInfo); // 设置JSON字段
        relDetail.setCreateBy(currentUserId);
        relDetail.setCreateTime(currentTime);
        relDetail.setUpdateBy(currentUserId);
        relDetail.setUpdateTime(currentTime);
        relDetail.setComAcctId(enterpriseId);
        return relDetail;
    }

    @Override
    public List<SsResourceRelDetailDTO> querySkillsForOpenApi(Long resourceId) {
        if (resourceId == null) {
            logger.warn("查询数字员工技能列表失败：resourceId不能为空");
            return new ArrayList<>();
        }

        // Step 1: 查询关联关系，获取 relResourceId 列表
        List<SsResourceRelDetailDTO> relList = ssResourceRelDetailMapper.findByResourceIdAsDetail(resourceId);

        // 从关联关系列表提取 relResourceId
        List<Long> relResourceIds = collectSkillResourceIds(relList);
        if (relResourceIds.isEmpty()) {
            return new ArrayList<>();
        }

        // Step 2: 批量查询技能资源基础字段
        List<SsResource> skills = ssResourceMapper.selectBatchIds(relResourceIds);
        if (CollectionUtils.isEmpty(skills)) {
            return new ArrayList<>();
        }

        // Step 3: 构建技能 DTO，按 resourceBizType 分组
        Map<Long, SsResourceRelDetailDTO> dtoMap = new LinkedHashMap<>();
        List<Long> kgDocIds = new ArrayList<>();
        List<Long> toolIds = new ArrayList<>();
        List<Long> toolkitIds = new ArrayList<>();
        List<Long> kgDbIds = new ArrayList<>();
        buildSkillDtoMap(skills, dtoMap, kgDocIds, toolIds, toolkitIds, kgDbIds);

        // Step 4: 批量查询子表扩展数据
        fillExtData(dtoMap, kgDocIds, toolIds, toolkitIds, kgDbIds);

        logger.info("查询数字员工技能列表成功。resourceId: {}, 技能数量: {}", resourceId, dtoMap.size());
        return new ArrayList<>(dtoMap.values());
    }

    /**
     * 从关联关系列表提取 relResourceId
     *
     * @param relList
     * @return
     */
    private List<Long> collectSkillResourceIds(List<SsResourceRelDetailDTO> relList) {
        return relList.stream().map(SsResourceRelDetailDTO::getRelResourceId).filter(Objects::nonNull).distinct()
            .collect(Collectors.toList());
    }

    /**
     * 构建技能 DTO 并按 bizType 分组
     *
     * @param skills
     * @param dtoMap
     * @param kgDocIds
     * @param toolIds
     * @param toolkitIds
     * @param kgDbIds
     */
    private void buildSkillDtoMap(List<SsResource> skills, Map<Long, SsResourceRelDetailDTO> dtoMap,
        List<Long> kgDocIds, List<Long> toolIds, List<Long> toolkitIds, List<Long> kgDbIds) {
        for (SsResource skill : skills) {
            SsResourceRelDetailDTO dto = new SsResourceRelDetailDTO();
            dto.setResourceId(skill.getResourceId());
            dto.setResourceCode(skill.getResourceCode());
            dto.setResourceName(skill.getResourceName());
            dto.setResourceDesc(skill.getResourceDesc());
            dto.setResourceBizType(skill.getResourceBizType());
            dtoMap.put(skill.getResourceId(), dto);

            String bizType = skill.getResourceBizType();
            if ("KG_DOC".equals(bizType)) {
                kgDocIds.add(skill.getResourceId());
                dto.setExtDoc(new SsResExtDoc());
            }
            else if ("TOOL".equals(bizType)) {
                toolIds.add(skill.getResourceId());
                dto.setExtTool(new SsResExtTool());
            }
            else if ("TOOLKIT".equals(bizType)) {
                toolkitIds.add(skill.getResourceId());
                dto.setExtToolKit(new SsResExtToolKit());
            }
            else if ("KG_DB".equals(bizType)) {
                kgDbIds.add(skill.getResourceId());
                dto.setExtDbDatasets(new ArrayList<>());
            }
        }
    }

    /**
     * 批量查询子表扩展数据并填充到 DTO
     *
     * @param dtoMap
     * @param kgDocIds
     * @param toolIds
     * @param toolkitIds
     * @param kgDbIds
     */
    private void fillExtData(Map<Long, SsResourceRelDetailDTO> dtoMap, List<Long> kgDocIds, List<Long> toolIds,
        List<Long> toolkitIds, List<Long> kgDbIds) {
        if (!kgDocIds.isEmpty()) {
            List<SsResExtDoc> extDocs = ssResExtDocMapper.selectListByResourceIds(kgDocIds);
            for (SsResExtDoc extDoc : extDocs) {
                SsResourceRelDetailDTO dto = dtoMap.get(extDoc.getResourceId());
                if (dto != null) {
                    dto.setExtDoc(extDoc);
                }
            }
        }
        if (!toolIds.isEmpty()) {
            List<SsResExtTool> extTools = ssResExtToolMapper.selectListByResourceIds(toolIds);
            for (SsResExtTool extTool : extTools) {
                SsResourceRelDetailDTO dto = dtoMap.get(extTool.getResourceId());
                if (dto != null) {
                    dto.setExtTool(extTool);
                }
            }
        }
        if (!toolkitIds.isEmpty()) {
            List<SsResExtToolKit> extToolKits = ssResExtToolKitMapper.selectListByResourceIds(toolkitIds);
            for (SsResExtToolKit extToolKit : extToolKits) {
                SsResourceRelDetailDTO dto = dtoMap.get(extToolKit.getResourceId());
                if (dto != null) {
                    dto.setExtToolKit(extToolKit);
                }
            }
        }
        if (!kgDbIds.isEmpty()) {
            List<SsResExtDbDataset> allDatasets = ssResExtDbDatasetMapper.selectListByResourceIds(kgDbIds);
            Map<Long, List<SsResExtDbDataset>> grouped = allDatasets.stream()
                .collect(Collectors.groupingBy(SsResExtDbDataset::getResourceId));
            for (Map.Entry<Long, List<SsResExtDbDataset>> entry : grouped.entrySet()) {
                SsResourceRelDetailDTO dto = dtoMap.get(entry.getKey());
                if (dto != null) {
                    dto.setExtDbDatasets(entry.getValue());
                }
            }
        }
    }

}
