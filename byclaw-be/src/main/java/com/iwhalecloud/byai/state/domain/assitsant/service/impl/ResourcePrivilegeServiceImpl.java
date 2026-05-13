package com.iwhalecloud.byai.state.domain.assitsant.service.impl;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.feign.response.ManagerResponse;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.manager.mapper.superassist.SuasSuperassistResourcePrivilegeMapper;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassistResourcePrivilege;
import com.iwhalecloud.byai.state.domain.assitsant.service.ResourcePrivilegeService;
import com.iwhalecloud.byai.state.domain.assitsant.vo.ResourcePrivilegeRequestDto;
import com.iwhalecloud.byai.state.domain.assitsant.vo.ResourcePrivilegeQueryResponseDto;
import com.iwhalecloud.byai.common.feign.request.manager.PriviledgeDto;
import com.iwhalecloud.byai.common.feign.request.manager.PrivilegeGrantDto;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.Arrays;

/**
 * 资源授权服务实现类
 */
@Slf4j
@Service
public class ResourcePrivilegeServiceImpl implements ResourcePrivilegeService {

    // 资源类型常量（业务层使用）
    private static final String KNOWLEDGE_BASE = "KNOWLEDGE_BASE";

    private static final String DATA_BASE = "DATA_BASE";

    // 数据库层资源类型常量
    private static final List<String> KNOWLEDGE_RESOURCE_TYPE = Arrays.asList(AgentMetaEnum.KG_DOC.getCode(),
        AgentMetaEnum.KG_QA.getCode(), AgentMetaEnum.KG_TERM.getCode());

    private static final List<String> DATA_RESOURCE_TYPE = Arrays.asList(AgentMetaEnum.KG_DB.getCode());

    // 权限类型常量
    private static final String PRIVILEGE_TYPE_INNER = "INNER";

    private static final String PRIVILEGE_TYPE_OUTER = "OUTER";

    @Autowired
    private SuasSuperassistResourcePrivilegeMapper resourcePrivilegeMapper;

    @Autowired
    private SequenceService sequenceService;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public boolean saveResourcePrivilege(ResourcePrivilegeRequestDto requestDto) {
        try {
            // 参数校验
            validateRequest(requestDto);

            // 获取当前登录用户信息
            Long currentAssistantId = CurrentUserHolder.getAssistantId();
            if (currentAssistantId == null) {
                throw new BdpRuntimeException(I18nUtil.get("resource.privilege.get.current.user.failed"));
            }

            validateResourceIds(requestDto.getKnowledgeList(), KNOWLEDGE_BASE);
            validateResourceIds(requestDto.getDataList(), DATA_BASE);

            // 处理知识资源授权
            processResourcePrivileges(requestDto.getKnowledgeList(), KNOWLEDGE_BASE, requestDto.getPrivilegeType(),
                currentAssistantId);
            // 处理数据资源授权
            processResourcePrivileges(requestDto.getDataList(), DATA_BASE, requestDto.getPrivilegeType(),
                currentAssistantId);

            log.info("保存助理资源授权信息成功 - 助理ID: {}, 授权类型: {}", currentAssistantId, requestDto.getPrivilegeType());

            return true;

        }
        catch (Exception e) {
            // 系统异常记录日志并转换为业务异常
            log.error("保存助理资源授权信息失败", e);
            throw new BdpRuntimeException(I18nUtil.get("resource.privilege.save.failed", e.getMessage()));
        }
    }

    /**
     * 参数校验
     */
    private void validateRequest(ResourcePrivilegeRequestDto requestDto) {
        if (requestDto == null) {
            throw new BdpRuntimeException(I18nUtil.get("resource.privilege.request.param.not.empty"));
        }

        if (StringUtils.isBlank(requestDto.getPrivilegeType())) {
            throw new BdpRuntimeException(I18nUtil.get("resource.privilege.type.not.empty"));
        }

        if (!PRIVILEGE_TYPE_INNER.equals(requestDto.getPrivilegeType())
            && !PRIVILEGE_TYPE_OUTER.equals(requestDto.getPrivilegeType())) {
            throw new BdpRuntimeException(I18nUtil.get("resource.privilege.type.only.inner.or.outer"));
        }

        // if (CollectionUtils.isEmpty(requestDto.getKnowledgeList()) &&
        // CollectionUtils.isEmpty(requestDto.getDataList())) {
        // throw new BdpRuntimeException("知识资源列表和数据资源列表不能同时为空");
        // }
    }

    /**
     * 校验资源ID列表
     */
    private void validateResourceIds(List<Long> resourceIds, String resourceType) {
        if (CollectionUtils.isEmpty(resourceIds)) {
            log.warn("资源ID列表为空，资源类型: {}", resourceType);
            return;
        }

        // 校验资源ID是否有效（非空、非负数）
        for (Long resourceId : resourceIds) {
            if (resourceId == null || resourceId <= 0) {
                throw new BdpRuntimeException(I18nUtil.get("resource.privilege.id.invalid", resourceType, resourceId));
            }
        }
    }

    /**
     * 处理资源授权 - 区分首次配置和二次配置
     */
    private void processResourcePrivileges(List<Long> resourceIds, String resourceType, String privilegeType,
        Long assistantId) {
        // 映射助理资源类型到资源业务类型
        String resourceBizType = mapResourceTypeToResourceBizType(resourceType);

        // 1. 获取该资源类型下的默认权限列表（不分对外对内）
        List<PrivilegeGrantDto> defaultPrivileges = queryDefaultPrivileges(assistantId, resourceBizType, null);
        Set<Long> defaultResourceIds = defaultPrivileges.stream().map(PrivilegeGrantDto::getGrantObjId)
            .collect(Collectors.toSet());

        // 2. 获取现有助理权限表数据
        List<SuasSuperassistResourcePrivilege> existingPrivileges = getExistingPrivilegesByType(assistantId,
            resourceType);

        // 3. 判断是首次配置还是二次配置
        boolean isFirstTimeConfig = CollectionUtils.isEmpty(existingPrivileges);

        log.debug("权限配置判断 - 资源类型: {}, 权限类型: {}, 是否首次配置: {}, 默认权限数量: {}, 现有权限数量: {}", resourceType, privilegeType,
            isFirstTimeConfig, defaultResourceIds.size(), existingPrivileges.size());

        if (isFirstTimeConfig) {
            // 首次配置：比较与默认权限列表
            processFirstTimeConfig(resourceIds, resourceType, privilegeType, assistantId, defaultResourceIds);
        }
        else {
            // 二次配置：比较与默认权限列表和现有助理权限表
            processSecondTimeConfig(resourceIds, resourceType, privilegeType, assistantId, defaultResourceIds,
                existingPrivileges);
        }
    }

    /**
     * 处理首次配置
     */
    private void processFirstTimeConfig(List<Long> newResourceIds, String resourceType, String privilegeType,
        Long assistantId, Set<Long> defaultResourceIds) {
        // 检查权限列表是否与默认权限一致
        if (isResourceListConsistent(newResourceIds, defaultResourceIds)) {
            log.info("首次配置：权限列表与默认权限一致，不存储到suas表 - 资源类型: {}, 权限类型: {}, 资源数量: {}", resourceType, privilegeType,
                newResourceIds.size());
            return;
        }

        // 权限列表不一致，批量保存到助理权限表
        log.info("首次配置：权限列表与默认权限不一致，批量保存到suas表 - 资源类型: {}, 权限类型: {}, 前端资源数量: {}, 默认资源数量: {}", resourceType,
            privilegeType, newResourceIds.size(), defaultResourceIds.size());

        batchSavePrivileges(newResourceIds, resourceType, privilegeType, assistantId);
    }

    /**
     * 处理二次配置
     */
    private void processSecondTimeConfig(List<Long> newResourceIds, String resourceType, String privilegeType,
        Long assistantId, Set<Long> defaultResourceIds, List<SuasSuperassistResourcePrivilege> existingPrivileges) {
        // 1. 检查是否需要更新（与默认权限不一致 且 与现有助理权限不一致）
        if (shouldUpdatePrivileges(newResourceIds, defaultResourceIds, existingPrivileges, privilegeType)) {
            log.info("二次配置：需要更新权限 - 资源类型: {}, 权限类型: {}", resourceType, privilegeType);

            // 先删除原有的相关权限记录
            deleteExistingPrivileges(existingPrivileges, resourceType, privilegeType);

            // 再批量保存新的权限记录
            batchSavePrivileges(newResourceIds, resourceType, privilegeType, assistantId);
        }
        else {
            log.info("二次配置：权限无需更新 - 资源类型: {}, 权限类型: {}", resourceType, privilegeType);
        }
    }

    /**
     * 判断是否需要更新权限
     */
    private boolean shouldUpdatePrivileges(List<Long> newResourceIds, Set<Long> defaultResourceIds,
        List<SuasSuperassistResourcePrivilege> existingPrivileges, String privilegeType) {
        // 1. 与默认权限列表不一致
        boolean differentFromDefault = !isResourceListConsistent(newResourceIds, defaultResourceIds);

        // 2. 与现有助理权限表不一致
        Set<Long> existingResourceIds = existingPrivileges.stream()
            .filter(p -> privilegeType.equals(p.getPrivilegeType()))
            .map(SuasSuperassistResourcePrivilege::getResourceId).collect(Collectors.toSet());
        boolean differentFromExisting = !isResourceListConsistent(newResourceIds, existingResourceIds);

        // 两个条件都满足才需要更新
        return differentFromDefault && differentFromExisting;
    }

    /**
     * 删除现有的相关权限记录
     */
    private void deleteExistingPrivileges(List<SuasSuperassistResourcePrivilege> existingPrivileges,
        String resourceType, String privilegeType) {
        List<SuasSuperassistResourcePrivilege> privilegesToDelete = existingPrivileges.stream()
            .filter(p -> privilegeType.equals(p.getPrivilegeType()))
            .filter(p -> resourceType.equals(p.getResourceType())).collect(Collectors.toList());

        for (SuasSuperassistResourcePrivilege privilege : privilegesToDelete) {
            resourcePrivilegeMapper.deleteById(privilege.getId());
            log.info("删除现有权限记录 - 记录ID: {}, 资源ID: {}, 资源类型: {}, 权限类型: {}", privilege.getId(), privilege.getResourceId(),
                resourceType, privilegeType);
        }
    }

    /**
     * 批量保存权限记录
     */
    private void batchSavePrivileges(List<Long> resourceIds, String resourceType, String privilegeType,
        Long assistantId) {
        List<SuasSuperassistResourcePrivilege> privileges = new ArrayList<>();

        for (Long resourceId : resourceIds) {
            SuasSuperassistResourcePrivilege newPrivilege = createNewPrivilege(resourceId, resourceType, privilegeType,
                assistantId);
            privileges.add(newPrivilege);
        }

        if (!privileges.isEmpty()) {
            batchInsertPrivileges(privileges);
            log.info("批量保存权限记录成功 - 资源类型: {}, 权限类型: {}, 数量: {}", resourceType, privilegeType, privileges.size());
        }
    }

    /**
     * 创建新的授权记录
     */
    private SuasSuperassistResourcePrivilege createNewPrivilege(Long resourceId, String resourceType,
        String privilegeType, Long assistantId) {
        SuasSuperassistResourcePrivilege privilege = new SuasSuperassistResourcePrivilege();
        privilege.setSuperassistId(assistantId);
        privilege.setResourceId(resourceId);
        privilege.setResourceType(resourceType);
        privilege.setPrivilegeType(privilegeType);
        privilege.setCreateTime(new Date());
        privilege.setId(sequenceService.nextVal());
        return privilege;
    }

    /**
     * 批量插入授权记录
     */
    private void batchInsertPrivileges(List<SuasSuperassistResourcePrivilege> privileges) {
        int insertCount = resourcePrivilegeMapper.batchInsert(privileges);
        log.info("批量插入授权记录成功，数量: {}, 实际插入: {}", privileges.size(), insertCount);
    }

    @Override
    public List<ResourcePrivilegeQueryResponseDto> getUserResourcePrivileges(Long userId, String privilegeType,
        String resourceType) {
        // 1. 优先查询超级助手资源权限表（关联查询资源名称）
        List<Map<String, Object>> superassistPrivileges = querySuperassistResourcePrivilegesWithNames(userId,
            privilegeType, resourceType);

        if (!CollectionUtils.isEmpty(superassistPrivileges)) {
            // 超级助手表有数据，直接返回（包含资源名称）
            List<ResourcePrivilegeQueryResponseDto> result = convertSuperassistPrivilegesToResponse(
                superassistPrivileges);
            log.info("从超级助手资源权限表关联查询到用户资源权限，用户ID: {}, 授权类型: {}, 资源类型: {}, 权限数量: {}", userId, privilegeType,
                resourceType, result.size());
            return result;
        }

        // 2. 超级助手表无数据，查询通用权限授权表 au_privilege_grant 作为默认权限
        String resourceBizType = mapResourceTypeToResourceBizType(resourceType);
        List<PrivilegeGrantDto> generalPrivileges = queryDefaultPrivileges(userId, resourceBizType, null);
        if (!CollectionUtils.isEmpty(generalPrivileges)) {
            List<ResourcePrivilegeQueryResponseDto> result = convertGeneralPrivilegesToResponse(generalPrivileges,
                privilegeType);
            log.info("从通用权限授权表查询到用户默认资源权限，用户ID: {}, 资源类型: {}, 权限数量: {}", userId, resourceType, result.size());
            return result;
        }

        log.info("用户无任何资源权限，用户ID: {}, 授权类型: {}, 资源类型: {}", userId, privilegeType, resourceType);
        return new ArrayList<>();
    }

    @Override
    public List<ResourcePrivilegeQueryResponseDto> getUserResourcePrivilegesBatch(Long userId,
        List<String> privilegeTypes, List<String> resourceTypes) {
        // 设置默认值
        if (CollectionUtils.isEmpty(privilegeTypes)) {
            privilegeTypes = Arrays.asList("INNER", "OUTER");
        }
        if (CollectionUtils.isEmpty(resourceTypes)) {
            resourceTypes = Arrays.asList("KNOWLEDGE_BASE", "DATA_BASE");
        }

        List<ResourcePrivilegeQueryResponseDto> allResults = new ArrayList<>();

        // 遍历所有权限类型和资源类型的组合
        for (String privilegeType : privilegeTypes) {
            for (String resourceType : resourceTypes) {
                List<ResourcePrivilegeQueryResponseDto> results = getUserResourcePrivileges(userId, privilegeType,
                    resourceType);
                allResults.addAll(results);
            }
        }

        log.info("批量查询用户资源权限完成，用户ID: {}, 权限类型: {}, 资源类型: {}, 总结果数量: {}", userId, privilegeTypes, resourceTypes,
            allResults.size());

        return allResults;
    }

    @Override
    public List<ResourcePrivilegeQueryResponseDto> getUserDefaultResourcePrivilegesBatch(Long userId,
        List<String> privilegeTypes, List<String> resourceTypes) {
        // 设置默认值
        if (CollectionUtils.isEmpty(privilegeTypes)) {
            privilegeTypes = Arrays.asList("INNER", "OUTER");
        }
        if (CollectionUtils.isEmpty(resourceTypes)) {
            resourceTypes = Arrays.asList("KNOWLEDGE_BASE", "DATA_BASE");
        }

        List<ResourcePrivilegeQueryResponseDto> allResults = new ArrayList<>();

        // 遍历所有权限类型和资源类型的组合
        for (String privilegeType : privilegeTypes) {
            for (String resourceType : resourceTypes) {
                // 查询默认权限（通用权限授权表）
                String resourceBizType = mapResourceTypeToResourceBizType(resourceType);
                List<PrivilegeGrantDto> generalPrivileges = queryDefaultPrivileges(userId, resourceBizType, null);
                if (!CollectionUtils.isEmpty(generalPrivileges)) {
                    List<ResourcePrivilegeQueryResponseDto> defaultResults = convertGeneralPrivilegesToResponse(
                        generalPrivileges, privilegeType);
                    allResults.addAll(defaultResults);
                    log.info("从通用权限授权表查询到默认权限，用户ID: {}, 授权类型: {}, 资源类型: {}, 权限数量: {}", userId, privilegeType,
                        resourceType, defaultResults.size());
                }
            }
        }

        log.info("批量查询用户默认资源权限完成，用户ID: {}, 权限类型: {}, 资源类型: {}, 总结果数量: {}", userId, privilegeTypes, resourceTypes,
            allResults.size());

        return allResults;
    }

    /**
     * 查询超级助手资源权限表数据（关联查询资源名称）
     */
    private List<Map<String, Object>> querySuperassistResourcePrivilegesWithNames(Long userId, String privilegeType,
        String resourceType) {
        // 调用关联查询方法，返回 Map 结果
        List<Map<String, Object>> allPrivileges = resourcePrivilegeMapper.selectByAssistantIdWithResourceName(userId);

        if (CollectionUtils.isEmpty(allPrivileges)) {
            return new ArrayList<>();
        }

        // 根据条件过滤权限
        List<Map<String, Object>> filteredPrivileges = allPrivileges.stream()
            .filter(privilege -> filterByPrivilegeTypeMap(privilege, privilegeType))
            .filter(privilege -> filterByResourceTypeMap(privilege, resourceType)).collect(Collectors.toList());

        log.debug("从超级助手资源权限表关联查询到权限数据，用户ID: {}, 授权类型: {}, 资源类型: {}, 总权限数量: {}, 过滤后数量: {}", userId, privilegeType,
            resourceType, allPrivileges.size(), filteredPrivileges.size());

        return filteredPrivileges;
    }

    /**
     * 查询通用权限授权表数据（默认权限） 使用红黑名单机制查询用户权限
     */
    private List<PrivilegeGrantDto> queryDefaultPrivileges(Long userId, String dbResourceType, Long resourceId) {
        List<PrivilegeGrantDto> allUserPrivileges = new ArrayList<>();

        // 构建红黑名单查询参数
        PriviledgeDto priviledgeDto = new PriviledgeDto();
        priviledgeDto.setType(dbResourceType);

        // 调用红黑名单查询接口
        ManagerResponse response = null;

        if (response.getCode() == ManagerResponse.SUCCESS) {
            // 解析权限数据
            List<PrivilegeGrantDto> privilegeList = parsePrivilegeResponse(response);

            // 过滤出当前用户的红名单权限（排除黑名单）
            List<PrivilegeGrantDto> userPrivileges = filterUserPrivileges(privilegeList, userId);

            if (resourceId != null) {
                // 过滤出当前用户对指定资源的权限
                userPrivileges = userPrivileges.stream()
                    .filter(priv -> priv.getGrantObjId() != null && priv.getGrantObjId().equals(resourceId))
                    .collect(Collectors.toList());
            }

            allUserPrivileges.addAll(userPrivileges);
        }

        log.debug("从通用权限授权表红黑名单查询到用户权限记录，用户ID: {}, 资源类型: {}, 资源ID: {}, 权限数量: {}", userId, dbResourceType, resourceId,
            allUserPrivileges.size());

        return allUserPrivileges;
    }

    /**
     * 解析权限响应数据
     */
    private List<PrivilegeGrantDto> parsePrivilegeResponse(ManagerResponse response) {
        List<PrivilegeGrantDto> privilegeList = new ArrayList<>();

        if (response.getData() instanceof List) {
            List<?> dataList = (List<?>) response.getData();
            for (Object item : dataList) {
                if (item instanceof java.util.Map) {
                    String jsonStr = JSON.toJSONString(item);
                    PrivilegeGrantDto dto = JSON.parseObject(jsonStr, PrivilegeGrantDto.class);
                    privilegeList.add(dto);
                }
            }
        }

        return privilegeList;
    }

    /**
     * 过滤用户权限（红名单 - 黑名单）
     */
    private List<PrivilegeGrantDto> filterUserPrivileges(List<PrivilegeGrantDto> privilegeList, Long userId) {
        // 按资源ID分组
        Map<Long, List<PrivilegeGrantDto>> resourcePrivileges = privilegeList.stream()
            .filter(priv -> priv.getGrantToObjId() != null && priv.getGrantToObjId().equals(userId))
            .collect(Collectors.groupingBy(PrivilegeGrantDto::getGrantObjId));

        List<PrivilegeGrantDto> userPrivileges = new ArrayList<>();

        for (Map.Entry<Long, List<PrivilegeGrantDto>> entry : resourcePrivileges.entrySet()) {
            List<PrivilegeGrantDto> resourcePrivs = entry.getValue();

            // 检查是否有黑名单权限
            boolean hasBlackList = resourcePrivs.stream().anyMatch(priv -> "BLACK".equals(priv.getGrantToType()));

            // 如果没有黑名单，则添加红名单权限
            if (!hasBlackList) {
                List<PrivilegeGrantDto> redList = resourcePrivs.stream()
                    .filter(priv -> "RED".equals(priv.getGrantToType())).collect(Collectors.toList());
                userPrivileges.addAll(redList);
            }
        }

        return userPrivileges;
    }

    /**
     * 转换超级助手资源权限表数据为响应格式（Map版本）
     */
    private List<ResourcePrivilegeQueryResponseDto> convertSuperassistPrivilegesToResponse(
        List<Map<String, Object>> privileges) {
        List<ResourcePrivilegeQueryResponseDto> result = new ArrayList<>();

        if (CollectionUtils.isEmpty(privileges)) {
            return result;
        }

        // 按资源类型和权限类型分组
        Map<String, List<Map<String, Object>>> groupedPrivileges = privileges.stream().collect(Collectors.groupingBy(
            privilege -> (String) privilege.get("resource_type") + "_" + (String) privilege.get("privilege_type")));

        for (Map.Entry<String, List<Map<String, Object>>> entry : groupedPrivileges.entrySet()) {
            List<Map<String, Object>> typePrivileges = entry.getValue();

            // 从第一个权限记录中获取类型信息
            Map<String, Object> firstPrivilege = typePrivileges.get(0);
            String resourceType = (String) firstPrivilege.get("resource_type");
            String privilegeType = (String) firstPrivilege.get("privilege_type");

            ResourcePrivilegeQueryResponseDto responseDto = new ResourcePrivilegeQueryResponseDto();
            responseDto.setResourceType(resourceType);
            responseDto.setResourceTypeDesc(getResourceTypeDesc(resourceType));
            responseDto.setPrivilegeType(privilegeType);
            responseDto.setDataSource("SUPERASSIST");

            // 转换资源列表
            List<ResourcePrivilegeQueryResponseDto.ResourceInfo> resourceList = new ArrayList<>();
            for (Map<String, Object> privilege : typePrivileges) {
                ResourcePrivilegeQueryResponseDto.ResourceInfo resourceInfo = new ResourcePrivilegeQueryResponseDto.ResourceInfo();
                resourceInfo.setResourceId((Long) privilege.get("resource_id"));
                resourceInfo.setResourceName((String) privilege.get("resource_name")); // 从 Map 中获取资源名称
                resourceInfo.setResourceDesc((String) privilege.get("resource_desc")); // 从 Map 中获取资源描述
                resourceInfo.setResourceBizType((String) privilege.get("resource_biz_type"));
                resourceInfo.setCreateTime((Date) privilege.get("create_time"));
                resourceInfo.setPrivilegeTypeDesc(getPrivilegeTypeDesc((String) privilege.get("privilege_type")));
                resourceInfo.setDataSource("SUPERASSIST");
                resourceList.add(resourceInfo);
            }

            responseDto.setResourceList(resourceList);
            result.add(responseDto);
        }

        return result;
    }

    /**
     * 转换通用权限授权表数据为响应格式
     */
    private List<ResourcePrivilegeQueryResponseDto> convertGeneralPrivilegesToResponse(
        List<PrivilegeGrantDto> privileges, String privilegeType) {
        List<ResourcePrivilegeQueryResponseDto> result = new ArrayList<>();

        // 按资源类型分组
        Map<String, List<PrivilegeGrantDto>> groupedPrivileges = privileges.stream()
            .collect(Collectors.groupingBy(privilege -> mapResourceBizTypeToResourceType(privilege.getGrantObjType())));

        for (Map.Entry<String, List<PrivilegeGrantDto>> entry : groupedPrivileges.entrySet()) {
            List<PrivilegeGrantDto> typePrivileges = entry.getValue();

            // 将数据库层资源类型转换为业务层资源类型
            String businessResourceType = entry.getKey();

            ResourcePrivilegeQueryResponseDto responseDto = new ResourcePrivilegeQueryResponseDto();
            responseDto.setResourceType(businessResourceType);
            responseDto.setResourceTypeDesc(getResourceTypeDesc(businessResourceType));
            responseDto.setPrivilegeType(privilegeType); // 使用传入的权限类型
            responseDto.setDataSource("GENERAL");

            // 转换资源列表
            List<ResourcePrivilegeQueryResponseDto.ResourceInfo> resourceList = new ArrayList<>();
            for (PrivilegeGrantDto privilege : typePrivileges) {
                ResourcePrivilegeQueryResponseDto.ResourceInfo resourceInfo = new ResourcePrivilegeQueryResponseDto.ResourceInfo();
                resourceInfo.setResourceId(privilege.getGrantObjId());
                resourceInfo.setResourceName(privilege.getGrantObjName());
                resourceInfo.setResourceDesc(privilege.getGrantObjDesc());
                resourceInfo.setResourceBizType(privilege.getGrantObjType());
                resourceInfo.setCreateTime(new Date()); // 通用权限表可能没有创建时间，使用当前时间
                resourceInfo.setPrivilegeTypeDesc("默认权限");
                resourceInfo.setDataSource("GENERAL");
                resourceList.add(resourceInfo);
            }

            responseDto.setResourceList(resourceList);
            result.add(responseDto);
        }

        return result;
    }

    /**
     * 获取资源类型描述
     */
    private String getResourceTypeDesc(String resourceType) {
        switch (resourceType) {
            case KNOWLEDGE_BASE:
                return "知识库";
            case DATA_BASE:
                return "数据库";
            default:
                return resourceType;
        }
    }

    /**
     * 获取授权类型描述
     */
    private String getPrivilegeTypeDesc(String privilegeType) {
        switch (privilegeType) {
            case "INNER":
                return "内部授权";
            case "OUTER":
                return "外部授权";
            default:
                return privilegeType;
        }
    }

    /**
     * 根据授权类型过滤权限（Map版本）
     */
    private boolean filterByPrivilegeTypeMap(Map<String, Object> privilege, String privilegeType) {
        return privilegeType.equals(privilege.get("privilege_type"));
    }

    /**
     * 根据资源类型过滤权限（Map版本）
     */
    private boolean filterByResourceTypeMap(Map<String, Object> privilege, String resourceType) {
        return resourceType.equals(privilege.get("resource_type"));
    }

    /**
     * 根据资源类型获取现有权限
     */
    private List<SuasSuperassistResourcePrivilege> getExistingPrivilegesByType(Long assistantId, String resourceType) {
        return resourcePrivilegeMapper.selectByCondition(assistantId, null, resourceType);
    }

    /**
     * 检查资源列表是否一致
     */
    private boolean isResourceListConsistent(List<Long> newResourceIds, Set<Long> defaultResourceIds) {
        if (newResourceIds.size() != defaultResourceIds.size()) {
            return false;
        }

        // 检查是否包含相同的资源ID
        return newResourceIds.stream().allMatch(defaultResourceIds::contains);
    }

    /**
     * 映射助理资源类型到资源业务类型
     */
    private String mapResourceTypeToResourceBizType(String resourceType) {
        if (KNOWLEDGE_BASE.equals(resourceType)) {
            return KNOWLEDGE_RESOURCE_TYPE.get(0); // KG_DOC
        }
        else if (DATA_BASE.equals(resourceType)) {
            return DATA_RESOURCE_TYPE.get(0); // KG_DB
        }
        else {
            return resourceType;
        }
    }

    /**
     * 映射资源业务类型到助理资源类型（反向映射）
     */
    private String mapResourceBizTypeToResourceType(String dbResourceType) {
        if (KNOWLEDGE_RESOURCE_TYPE.contains(dbResourceType)) {
            return KNOWLEDGE_BASE; // KG_DOC -> KNOWLEDGE_BASE
        }
        else if (DATA_RESOURCE_TYPE.contains(dbResourceType)) {
            return DATA_BASE; // KG_DB -> DATA_BASE
        }
        else {
            return dbResourceType;
        }
    }
}
