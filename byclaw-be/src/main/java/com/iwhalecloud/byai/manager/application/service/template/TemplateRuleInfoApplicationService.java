package com.iwhalecloud.byai.manager.application.service.template;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.application.service.memory.MemoryLibraryApplicationService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.domain.template.service.ResourceTemplateRelationService;
import com.iwhalecloud.byai.manager.domain.template.service.TemplateRuleInfoService;
import com.iwhalecloud.byai.manager.mapper.template.TemplateRuleInfoMapper;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.apache.commons.lang3.ObjectUtils;
import org.apache.commons.lang3.StringUtils;
import com.iwhalecloud.byai.manager.dto.template.MemoryConfigDTO;
import com.iwhalecloud.byai.manager.dto.template.SceneOperationRequest;
import com.iwhalecloud.byai.manager.dto.template.TemplateRuleInfoCreateRequest;
import com.iwhalecloud.byai.manager.entity.template.ResourceTemplateRelation;
import com.iwhalecloud.byai.manager.entity.template.TemplateRuleInfo;
import com.iwhalecloud.byai.manager.qo.template.TemplateRuleInfoQueryQo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * 模版规则信息应用服务
 *
 * @author system
 * &#064;date  2025-01-XX
 */
@Service
public class TemplateRuleInfoApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(TemplateRuleInfoApplicationService.class);


    @Autowired
    private TemplateRuleInfoService templateRuleInfoService;

    @Autowired
    private ResourceTemplateRelationService resourceTemplateRelationService;

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private MemoryLibraryApplicationService memoryLibraryApplicationService;

    @Autowired
    private TemplateRuleInfoMapper templateRuleInfoMapper;

    /**
     * 创建模版规则信息
     *
     * @param request 创建请求
     * @return 模版ID
     */
    public Long createTemplateRuleInfo(TemplateRuleInfoCreateRequest request) {
        Long userId = CurrentUserHolder.getCurrentUserId();

        TemplateRuleInfo templateRuleInfo = new TemplateRuleInfo();
        templateRuleInfo.setTemplateId(SequenceService.nextVal());
        templateRuleInfo.setTemplateType(request.getTemplateType());
        templateRuleInfo.setUserId(CurrentUserHolder.getCurrentUserId());
        templateRuleInfo.setRuleName(request.getRuleName());
        templateRuleInfo.setRuleContent(request.getRuleContent());
        templateRuleInfo.setCreateTime(new Date());

        // 如果是超级助手，需要保存 resource_template_relation 表（直接插入，不删除）
        if ("SUPER_ASSISTANT".equals(request.getTemplateType())) {
            // 超级助手的 resource_id 就是用户id
            String memoryRuleId = null;

            // 创建或获取记忆库
            String userName = CurrentUserHolder.getCurrentUserName();
            String libraryName = (StringUtils.isNotBlank(userName) ? userName : "用户") + "超级助手的记忆库";
            String description = "超级助手记忆库";
            Long memoryLibraryId = memoryLibraryApplicationService.createOrGetMemoryLibraryForDigitalEmployee(
                    userId, userId, "SUPER_ASSISTANT", libraryName, description);

            // 创建超级助手的场景（调用智能体的 Feign 接口失败时会抛异常）
            String sceneId = memoryLibraryApplicationService.saveMemoryScene(
                    memoryLibraryId,
                    request.getRuleName(),
                    request.getRuleName(), // sceneDesc使用ruleName
                    request.getRuleContent() // ruleString
            );
            memoryRuleId = sceneId;

            logger.info("创建超级助手记忆库和场景成功，userId: {}, templateId: {}, sceneId: {}",
                    userId, templateRuleInfo.getTemplateId(), sceneId);

            // 保存关联关系，传入 memoryRuleId（场景ID）
            saveResourceTemplateRelationDirect(userId, templateRuleInfo.getTemplateId(), memoryRuleId);
        }
        templateRuleInfoService.save(templateRuleInfo);
        return templateRuleInfo.getTemplateId();
    }

    /**
     * 查询模版规则信息列表（分页）
     * 使用 MyBatis Plus 自动分页功能
     * 当查询条件包含 resourceId 时，返回包含 memoryRuleId 的 Map 列表
     *
     * @param queryQo 查询条件
     * @return 分页结果（如果包含 resourceId，返回 PageInfo&lt;Map&gt;，否则返回 PageInfo&lt;TemplateRuleInfo&gt;）
     */
    public PageInfo<?> queryTemplateRuleInfo(
            TemplateRuleInfoQueryQo queryQo) {
        // 创建分页对象，MyBatis Plus 会自动拦截并处理分页
        long pageNum = queryQo.getPageNum() > 0 ? queryQo.getPageNum() : 1L;
        long pageSize = queryQo.getPageSize() > 0 ? queryQo.getPageSize() : 10L;

        // 如果查询条件包含 resourceId，使用返回 Map 的查询方法（包含 memory_rule_id）
        if (queryQo.getResourceId() != null) {
            Page<Map<String, Object>> page = new Page<>(pageNum, pageSize);
            List<Map<String, Object>> records = templateRuleInfoMapper.selectByConditionWithMemoryRuleId(page, queryQo);
            page.setRecords(records);
            return PageHelperUtil.toPageInfo(page);
        } else {
            // 否则使用原来的查询方法
            Page<TemplateRuleInfo> page = new Page<>(pageNum, pageSize);
            Page<TemplateRuleInfo> resultPage = templateRuleInfoService.findByCondition(page, queryQo);
            return PageHelperUtil.toPageInfo(resultPage);
        }
    }


    /**
     * 保存资源模版关联关系（根据记忆配置列表，增量添加，不删除历史数据）
     *
     * @param resourceId 资源ID
     * @param memoryConfigList 记忆配置列表（包含 templateId）
     * @param userId 用户ID
     * @param libraryId 记忆库ID
     */
    public void saveResourceTemplateRelationsByMemoryConfig(Long resourceId,
                                                             List<MemoryConfigDTO> memoryConfigList,
                                                             Long userId, Long libraryId) {
        if (CollectionUtils.isEmpty(memoryConfigList)) {
            return;
        }

        // 查询现有的关联关系（只查询该用户创建的）
        List<ResourceTemplateRelation> existingRelations = resourceTemplateRelationService.findByResourceIdAndUserId(resourceId, userId);
        // 构建现有关联关系的Map，key为templateId，value为ResourceTemplateRelation
        Map<Long, ResourceTemplateRelation> existingRelationMap = existingRelations.stream()
                .collect(Collectors.toMap(ResourceTemplateRelation::getTemplateId, relation -> relation, (v1, v2) -> v1));

        // 从 memoryConfigList 中提取 templateId，过滤掉 null 值
        List<Long> newTemplateIds = memoryConfigList.stream()
                .map(MemoryConfigDTO::getTemplateId)
                .filter(Objects::nonNull)
                .distinct()
                .collect(Collectors.toList());

        if (CollectionUtils.isEmpty(newTemplateIds)) {
            return;
        }

        // 处理关联关系：新增和更新（如果 memory_rule_id 为空则更新）
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        Date currentTime = new Date();
        List<ResourceTemplateRelation> newRelations = new ArrayList<>();
        List<ResourceTemplateRelation> updateRelations = new ArrayList<>();

        for (MemoryConfigDTO memoryConfig : memoryConfigList) {
            Long templateId = memoryConfig.getTemplateId();
            if (templateId == null) {
                continue;
            }

            // 同步场景信息到记忆引擎并获取 memory_rule_id
            String memoryRuleId;

            // 如果已存在相同的关联关系
            ResourceTemplateRelation existingRelation = existingRelationMap.get(templateId);
            if (!ObjectUtils.isEmpty(existingRelation)) {
                // 如果 memory_rule_id 为空，需要更新
                if (StringUtils.isBlank(existingRelation.getMemoryRuleId())) {
                    memoryRuleId = syncSceneToMemoryEngine(resourceId, memoryConfig, libraryId);
                    existingRelation.setMemoryRuleId(memoryRuleId);
                    updateRelations.add(existingRelation);
                }
                // 如果 memory_rule_id 已有值，保持不变，跳过
                continue;
            }
            memoryRuleId = syncSceneToMemoryEngine(resourceId, memoryConfig, libraryId);
            // 创建新的关联关系
            ResourceTemplateRelation relation = new ResourceTemplateRelation();
            relation.setResourceTemplateId(SequenceService.nextVal());
            relation.setResourceId(resourceId);
            relation.setTemplateId(templateId);
            relation.setCreateTime(currentTime);
            relation.setCreateBy(currentUserId);
            relation.setMemoryRuleId(memoryRuleId);
            newRelations.add(relation);
        }

        // 批量保存新的关联关系
        if (!CollectionUtils.isEmpty(newRelations)) {
            resourceTemplateRelationService.batchSave(newRelations);
        }

        // 批量更新 memory_rule_id 为空的关联关系
        if (!CollectionUtils.isEmpty(updateRelations)) {
            for (ResourceTemplateRelation relation : updateRelations) {
                resourceTemplateRelationService.updateById(relation);
            }
        }
    }

    /**
     * 同步场景信息到记忆引擎，返回 sceneId
     *
     * @param resourceId 资源ID
     * @param memoryConfig 记忆配置
     * @param libraryId 记忆库ID
     * @return sceneId，失败返回null
     */
    private String syncSceneToMemoryEngine(Long resourceId, MemoryConfigDTO memoryConfig, Long libraryId) {
        if (memoryConfig == null || libraryId == null) {
            return null;
        }

        try {
            TemplateRuleInfo templateRuleInfo = templateRuleInfoService.findById(memoryConfig.getTemplateId());
            if (ObjectUtils.isEmpty(templateRuleInfo) ||
                    StringUtils.isBlank(memoryConfig.getRuleName()) ||
                    StringUtils.isBlank(memoryConfig.getRuleContent())) {
                return null;
            }

            // 调用场景保存接口
            String sceneId = memoryLibraryApplicationService.saveMemoryScene(
                    libraryId,
                    memoryConfig.getRuleName(),
                    memoryConfig.getRuleName(), // sceneDesc使用ruleName
                    memoryConfig.getRuleContent() // ruleString
            );

            return sceneId;
        } catch (Exception e) {
            logger.error("同步场景信息到记忆引擎失败，templateId: {}, error: {}",
                    memoryConfig.getTemplateId(), e.getMessage(), e);
            return null;
        }
    }

    /**
     * 直接保存资源模版关联关系（不删除，直接插入）
     * 用于超级助手创建模版时保存关联关系
     *
     * @param resourceId 资源ID
     * @param templateId 模版ID
     * @param memoryRuleId 记忆规则ID（可选）
     */
    public void saveResourceTemplateRelationDirect(Long resourceId, Long templateId, String memoryRuleId) {
        if (resourceId == null || templateId == null) {
            return;
        }

        // 直接插入关联关系，不删除旧数据
        ResourceTemplateRelation relation = new ResourceTemplateRelation();
        relation.setResourceTemplateId(SequenceService.nextVal());
        relation.setResourceId(resourceId);
        relation.setTemplateId(templateId);
        relation.setCreateTime(new Date());
        relation.setCreateBy(CurrentUserHolder.getCurrentUserId());
        relation.setMemoryRuleId(memoryRuleId);
        resourceTemplateRelationService.save(relation);
    }

    /**
     * 根据资源ID和用户ID查询记忆配置列表
     *
     * @param resourceId 资源ID
     * @param userId 用户ID
     * @return 记忆配置列表
     */
    public List<MemoryConfigDTO> findMemoryConfigsByResourceIdAndUserId(Long resourceId, Long userId) {
        List<TemplateRuleInfo> templateRuleInfoList = templateRuleInfoService.findByResourceIdAndUserId(resourceId,
                userId);
        if (CollectionUtils.isEmpty(templateRuleInfoList)) {
            return new ArrayList<>();
        }

        return templateRuleInfoList.stream().map(template -> {
            MemoryConfigDTO dto = new MemoryConfigDTO();
            dto.setRuleName(template.getRuleName());
            dto.setRuleContent(template.getRuleContent());
            dto.setTemplateId(template.getTemplateId());
            return dto;
        }).collect(Collectors.toList());
    }

    /**
     * 删除场景
     *
     * @param request 场景操作请求
     */
    @Transactional(rollbackFor = Exception.class)
    public void deleteScene(SceneOperationRequest request) {
        Long templateId = request.getTemplateId();
        Long userId = CurrentUserHolder.getCurrentUserId();

        logger.info("开始删除场景，templateId: {}, userId: {}", templateId, userId);

        // 1. 查询模板信息
        TemplateRuleInfo templateRuleInfo = templateRuleInfoService.findById(templateId);
        if (templateRuleInfo == null) {
            throw new RuntimeException(I18nUtil.get("template.not.exist", templateId));
        }

        // 2. 根据 templateId 查询 resource_template_relation 表中关联的所有场景
        List<ResourceTemplateRelation> relations = resourceTemplateRelationService.findByTemplateId(templateId);
        if (CollectionUtils.isEmpty(relations)) {
            logger.warn("未找到关联关系，templateId: " + templateId);
        }
        else {
            // 3. 循环调用智能体的 Feign 删除场景接口
            for (ResourceTemplateRelation relation : relations) {
                String sceneId = relation.getMemoryRuleId();
                if (StringUtils.isNotBlank(sceneId)) {
                    try {
                        logger.info("调用智能体删除场景接口成功，sceneId: {}, resourceTemplateId: {}", sceneId, relation.getResourceTemplateId());
                    } catch (Exception e) {
                        logger.error("调用智能体删除场景接口失败，sceneId: {}, resourceTemplateId: {}, error: {}",
                            sceneId, relation.getResourceTemplateId(), e.getMessage(), e);
                        // 记录错误但继续删除其他场景，不中断流程
                    }
                }
                else {
                    logger.warn("场景ID为空，跳过调用删除场景接口，resourceTemplateId: " + relation.getResourceTemplateId());
                }
            }
        }

        // 4. 删除 resource_template_relation 表中对应的所有关联关系（根据 templateId）
        resourceTemplateRelationService.deleteByTemplateId(templateId);
        logger.info("删除 resource_template_relation 表数据完成，templateId: {}", templateId);

        // 5. 删除 template_rule_info 表的数据（只删除该用户创建的模板）
        if (userId.equals(templateRuleInfo.getUserId())) {
            templateRuleInfoService.deleteById(templateId);
            logger.info("删除 template_rule_info 表数据完成，templateId: {}", templateId);
        } else {
            logger.warn("用户无权限删除该模板，templateId: " + templateId + ", userId: " + userId + ", templateUserId: " + templateRuleInfo.getUserId());
            throw new RuntimeException(I18nUtil.get("template.delete.permission.denied", templateId));
        }

        logger.info("删除场景完成，templateId: {}", templateId);
    }

    /**
     * 修改场景
     *
     * @param request 场景操作请求（需要包含 ruleName 和 ruleContent）
     */
    @Transactional(rollbackFor = Exception.class)
    public void updateScene(SceneOperationRequest request) {
        Long templateId = request.getTemplateId();
        Long userId = CurrentUserHolder.getCurrentUserId();

        logger.info("开始修改场景，templateId: {}, userId: {}", templateId, userId);

        // 1. 查询模板信息
        TemplateRuleInfo templateRuleInfo = templateRuleInfoService.findById(templateId);
        if (templateRuleInfo == null) {
            throw new RuntimeException(I18nUtil.get("template.not.exist", templateId));
        }

        // 2. 更新 template_rule_info 表
        if (StringUtils.isNotBlank(request.getRuleName())) {
            templateRuleInfo.setRuleName(request.getRuleName());
        }
        if (StringUtils.isNotBlank(request.getRuleContent())) {
            templateRuleInfo.setRuleContent(request.getRuleContent());
        }
        templateRuleInfo.setUpdateBy(userId);
        templateRuleInfo.setUpdateTime(new Date());
        templateRuleInfoService.update(templateRuleInfo);
        logger.info("更新 template_rule_info 表数据完成，templateId: {}", templateId);

        // 3. 根据 templateId 查询 resource_template_relation 表中关联的所有场景
        List<ResourceTemplateRelation> relations = resourceTemplateRelationService.findByTemplateId(templateId);
        if (CollectionUtils.isEmpty(relations)) {
            logger.warn("未找到关联关系，templateId: " + templateId);
            return;
        }

        // 4. 循环调用智能体的 Feign 修改场景接口
        for (ResourceTemplateRelation relation : relations) {
            String sceneId = relation.getMemoryRuleId();
            if (StringUtils.isBlank(sceneId)) {
                logger.warn("场景ID为空，跳过调用修改场景接口，resourceTemplateId: " + relation.getResourceTemplateId());
                continue;
            }

            Long resourceId = relation.getResourceId();

            // 5. 获取或创建记忆库
            Long libraryId;
            try {
                // 根据 resourceId 确定 templateType
                String templateType = request.getTemplateType();
                if (templateType == null) {
                    // 如果没有传入 templateType，尝试从模板信息中获取
                    templateType = templateRuleInfo.getTemplateType();
                }
                // 如果 resourceId 等于 userId，说明是超级助手
                if (resourceId != null && resourceId.equals(userId) && templateType == null) {
                    templateType = "SUPER_ASSISTANT";
                }
                if (templateType == null) {
                    templateType = "DIGITAL_EMPLOYEE";
                }

                libraryId = memoryLibraryApplicationService.createOrGetMemoryLibraryForDigitalEmployee(
                        resourceId,
                        userId,
                        templateType,
                        null, // resourceName
                        null  // resourceDesc
                );
            } catch (Exception e) {
                logger.error("获取或创建记忆库失败，resourceId: {}, error: {}", resourceId, e.getMessage(), e);
                // 记录错误但继续修改其他场景，不中断流程
                continue;
            }

            // 6. 调用智能体的 Feign 保存场景接口（传入 sceneId 进行更新）
            try {
                String updatedSceneId = memoryLibraryApplicationService.saveMemoryScene(
                        libraryId,
                        templateRuleInfo.getRuleName(),
                        templateRuleInfo.getRuleName(), // sceneDesc使用ruleName
                        templateRuleInfo.getRuleContent(), // ruleString
                        sceneId // 传入 sceneId 进行更新
                );
                logger.info("调用智能体修改场景接口成功，sceneId: {}, resourceTemplateId: {}", updatedSceneId, relation.getResourceTemplateId());
            } catch (Exception e) {
                logger.error("调用智能体修改场景接口失败，sceneId: {}, resourceTemplateId: {}, error: {}",
                    sceneId, relation.getResourceTemplateId(), e.getMessage(), e);
                // 记录错误但继续修改其他场景，不中断流程
            }
        }

        logger.info("修改场景完成，templateId: {}", templateId);
    }

    /**
     * 更新 resource_template_relation 表的 memory_rule_id 字段
     *
     * @param request 更新请求，包含：
     *                - templateId: 模板ID（必填）
     *                - resourceId: 资源ID（必填）
     *                - memoryRuleId: 场景ID（必填）
     */
    @Transactional(rollbackFor = Exception.class)
    public void updateResourceTemplateRelationMemoryRuleId(Map<String, Object> request) {
        // 参数校验
        Object templateIdObj = request.get("templateId");
        Object resourceIdObj = request.get("resourceId");
        Object memoryRuleIdObj = request.get("memoryRuleId");

        if (templateIdObj == null || resourceIdObj == null || memoryRuleIdObj == null) {
            throw new RuntimeException(I18nUtil.get("template.update.relation.params.incomplete"));
        }

        Long templateId = Long.parseLong(templateIdObj.toString());
        Long resourceId = Long.parseLong(resourceIdObj.toString());
        String memoryRuleId = memoryRuleIdObj.toString();

        logger.info("开始更新 resource_template_relation 表的 memory_rule_id 字段，templateId: {}, resourceId: {}, memoryRuleId: {}",
                templateId, resourceId, memoryRuleId);

        // 根据模板ID和资源ID查找唯一一条关联关系并更新
        ResourceTemplateRelation relation = resourceTemplateRelationService.findByTemplateIdAndResourceId(templateId, resourceId);
        if (relation == null) {
            logger.warn("未找到关联关系，templateId: " + templateId + ", resourceId: " + resourceId);
            throw new RuntimeException(I18nUtil.get("template.relation.not.found", templateId, resourceId));
        }

        // 更新 memory_rule_id 字段
        if (StringUtils.isBlank(relation.getMemoryRuleId())) {
            relation.setMemoryRuleId(memoryRuleId);
            resourceTemplateRelationService.updateById(relation);
        }

        logger.info("成功更新 resource_template_relation 表的 memory_rule_id 字段，resourceTemplateId: {}, memoryRuleId: {}",
                relation.getResourceTemplateId(), memoryRuleId);

    }
}

