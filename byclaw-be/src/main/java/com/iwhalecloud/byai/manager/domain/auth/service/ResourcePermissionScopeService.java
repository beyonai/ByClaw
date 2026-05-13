package com.iwhalecloud.byai.manager.domain.auth.service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrantWithOrgPath;
import com.iwhalecloud.byai.manager.mapper.organization.OrganizationMapper;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.dto.resource.PermissionDto;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersOrganizationMapper;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;

/**
 * 资源权限范围分析服务 用于分析每个resource_id的权限范围：仅个人可见、全公司可见、部分可�?
 */
@Service
public class ResourcePermissionScopeService {

    @Autowired
    private PrivilegeGrantMapper privilegeGrantMapper;

    @Autowired
    private OrganizationMapper organizationMapper;

    @Autowired
    private UsersMapper usersMapper;

    @Autowired
    private UsersOrganizationMapper usersOrganizationMapper;

    /**
     * 权限范围枚举
     */
    public enum PermissionScope {
        PERSONAL_ONLY(1, "仅个人可见"), COMPANY_WIDE(3, "全公司可见"), PARTIAL(2, "部分可见");

        private final int code;

        private final String description;

        PermissionScope(int code, String description) {
            this.code = code;
            this.description = description;
        }

        public int getCode() {
            return code;
        }

        public String getDescription() {
            return description;
        }
    }

    /**
     * 分析指定资源ID的权限范�?
     *
     * @param resourceId 资源ID
     * @param resourceType 资源类型
     * @return 权限范围分析结果
     */
    public PermissionScopeResult analyzePermissionScope(Long resourceId, String resourceType) {
        // 1. 查询该资源的所有授权记�?
        List<PrivilegeGrant> allGrants = queryResourceGrants(resourceId, resourceType);

        if (CollectionUtils.isEmpty(allGrants)) {
            return new PermissionScopeResult(PermissionScope.PERSONAL_ONLY, "无授权记录，仅创建者可见");
        }

        // 2. 分离红名单和黑名�?
        List<PrivilegeGrant> redListGrants = allGrants.stream().filter(grant -> "RED".equals(grant.getGrantToType()))
            .collect(Collectors.toList());

        List<PrivilegeGrant> blackListGrants = allGrants.stream()
            .filter(grant -> "BLACK".equals(grant.getGrantToType())).collect(Collectors.toList());

        // 3. 分析权限范围
        return analyzeScope(redListGrants, blackListGrants);
    }

    /**
     * 批量分析多个资源ID的权限范�?
     *
     * @return 权限范围分析结果映射
     */
    @SuppressWarnings("checkstyle:WhitespaceAfter")
    public Map<Long, PermissionScopeResult> analyzePermissionScopeBatch(PermissionDto permissionDto) {
        if (CollectionUtils.isEmpty(permissionDto.getResourceIds())) {
            return new HashMap<>();
        }

        // 1. 批量查询所有资源的授权记录
        List<PrivilegeGrantWithOrgPath> allGrants = queryResourceGrantsBatch(permissionDto);

        // 2. 按资源ID分组
        Map<Long, List<PrivilegeGrantWithOrgPath>> grantsByResourceId = allGrants.stream()
            .collect(Collectors.groupingBy(PrivilegeGrant::getGrantObjId));

        // 得到各组的红名单
        Map<Long, List<PrivilegeGrantWithOrgPath>> redListMap = grantsByResourceId.entrySet().stream()
            .collect(Collectors.toMap(Map.Entry::getKey,
                entry -> entry.getValue().stream().filter(item -> "RED".equals(item.getGrantToType())) // 只保�?red 的数�?
                    .collect(Collectors.toList())));

        // 得到组织的orgPathCode
        Map<Long, String> orgPathMap = allGrants.stream().filter(item -> "ORG".equals(item.getGrantToObjType()))
            .collect(Collectors.toMap(PrivilegeGrantWithOrgPath::getGrantToObjId, PrivilegeGrantWithOrgPath::getOrgPath,
                (t1, t2) -> t1));

        // 得到组织的stationPathCode
        Map<Long, String> stationPathMap = allGrants.stream().filter(item -> "STATION".equals(item.getGrantToObjType()))
            .collect(Collectors.toMap(PrivilegeGrantWithOrgPath::getGrantToObjId,
                PrivilegeGrantWithOrgPath::getStationPath));

        // 2.5. 按资源ID分组获取黑名单数据（避免不同资源间的黑名单混淆）
        Map<Long, Map<String, Set<Long>>> blacklistedDataByResource = getBlacklistedUserIdsByResource(
            grantsByResourceId);

        // 3. 批量分析每个资源的权限范�?
        Map<Long, PermissionScopeResult> results = new HashMap<>();
        for (Long resourceId : permissionDto.getResourceIds()) {
            // 得到红名单列�?
            List<PrivilegeGrantWithOrgPath> redList = redListMap.getOrDefault(resourceId, new ArrayList<>());
            // 得到黑名单列�?
            Map<String, Set<Long>> resourceBlacklistedData = blacklistedDataByResource.getOrDefault(resourceId,
                new HashMap<>());

            // 设置黑名单�?
            results.put(resourceId,
                analyzeScopeFromGrantsWithBlacklist(redList, resourceBlacklistedData, orgPathMap, stationPathMap));
        }

        return results;
    }

    /**
     * 分析单个资源的权限范围（返回数字代码 1/2/3�?
     */
    public int analyzePermissionScopeCode(Long resourceId, String resourceType) {
        PermissionScopeResult result = analyzePermissionScope(resourceId, resourceType);
        return result.getScopeCode();
    }

    /**
     */
    public Map<Long, Integer> analyzePermissionScopeBatchCodes(PermissionDto permissionDto) {
        Map<Long, PermissionScopeResult> results = analyzePermissionScopeBatch(permissionDto);
        Map<Long, Integer> codeMap = new HashMap<>();
        results.forEach((id, r) -> codeMap.put(id, r != null ? r.getScopeCode() : 0));
        return codeMap;
    }

    /**
     * 查询资源的所有授权记�?
     */
    private List<PrivilegeGrant> queryResourceGrants(Long resourceId, String resourceType) {
        LambdaQueryWrapper<PrivilegeGrant> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(PrivilegeGrant::getGrantObjId, resourceId);
        queryWrapper.eq(PrivilegeGrant::getGrantObjType, resourceType);
        queryWrapper.eq(PrivilegeGrant::getStatusCd, "A"); // 只查询有效记�?
        queryWrapper.eq(PrivilegeGrant::getOperType, "READ"); // 只查询读权限
        queryWrapper.in(PrivilegeGrant::getGrantType, "AVAILABLE_USE", "ALLOW_MANAGE"); // 使用授权和管理授�?

        return privilegeGrantMapper.selectList(queryWrapper);
    }

    /**
     * 批量查询多个资源的所有授权记录（包含组织路径信息�?使用联表查询直接获取组织的org_path信息，避免后续的递归查询组织层级关系
     */
    private List<PrivilegeGrantWithOrgPath> queryResourceGrantsBatch(PermissionDto permissionDto) {
        return privilegeGrantMapper.selectResourceGrantsWithOrgPath(permissionDto);
    }

    /**
     * 分析权限范围
     */
    private PermissionScopeResult analyzeScope(List<PrivilegeGrant> redListGrants,
        List<PrivilegeGrant> blackListGrants) {
        return analyzeScopeFromGrants(redListGrants, blackListGrants);
    }

    /**
     * 从授权记录分析权限范围（使用预查询的黑名单数据和组织路径信息�?
     */
    private PermissionScopeResult analyzeScopeFromGrantsWithBlacklist(List<PrivilegeGrantWithOrgPath> redList,
        Map<String, Set<Long>> blacklistedData, Map<Long, String> orgPathMap, Map<Long, String> stationPathMap) {
        if (CollectionUtils.isEmpty(redList)) {
            return new PermissionScopeResult(PermissionScope.PERSONAL_ONLY, "无授权记录，仅创建者可见");
        }

        // 从红名单中移除被黑名单影响的授权
        List<PrivilegeGrantWithOrgPath> effectiveRedListGrants = removeBlacklistedGrantsWithPreloadedData(redList,
            blacklistedData, orgPathMap, stationPathMap);

        List<String> pathCodes = getFirstLevelPath();

        return analyzeEffectiveScopeWithPath(effectiveRedListGrants, pathCodes);
    }

    private List<String> getFirstLevelPath() {
        LambdaQueryWrapper<Organization> organizationQueryWrapper = new LambdaQueryWrapper<>();
        organizationQueryWrapper.eq(Organization::getParentOrgId, -1L);
        List<Organization> organizationList = organizationMapper.selectList(organizationQueryWrapper);
        return organizationList.stream().filter(item -> null != item.getPathCode()).map(Organization::getPathCode)
            .collect(Collectors.toList());
    }

    /**
     * 基于有效的红名单分析权限范围（使用组织路径信息）
     */
    private PermissionScopeResult analyzeEffectiveScopeWithPath(List<PrivilegeGrantWithOrgPath> effectiveRedListGrants,
        List<String> pathCodes) {
        if (CollectionUtils.isEmpty(effectiveRedListGrants)) {
            return new PermissionScopeResult(PermissionScope.PERSONAL_ONLY, "无有效授权，仅创建者可见");
        }

        // 检查是否有全公司授权（使用组织路径信息�?
        boolean hasCompanyWideAccess = effectiveRedListGrants.stream().anyMatch(grant -> grant.isCompanyWideOrg());

        if (hasCompanyWideAccess) {
            return new PermissionScopeResult(PermissionScope.COMPANY_WIDE, "全公司可见");
        }

        // 检查是否只有个人授�?
        boolean onlyPersonalAccess = effectiveRedListGrants.stream()
            .allMatch(grant -> "USER".equals(grant.getGrantToObjType()));

        if (onlyPersonalAccess && effectiveRedListGrants.size() == 1) {
            return new PermissionScopeResult(PermissionScope.PERSONAL_ONLY, "仅个人可见");
        }

        // 其他情况都是部分可见
        return new PermissionScopeResult(PermissionScope.PARTIAL, "部分组织/人员可见");
    }

    /**
     * 从红名单中移除被黑名单影响的授权（使用预查询的黑名单数据，支持组织路径）
     */
    private List<PrivilegeGrantWithOrgPath> removeBlacklistedGrantsWithPreloadedData(
        List<PrivilegeGrantWithOrgPath> redListGrants, Map<String, Set<Long>> blacklistedData,
        Map<Long, String> orgPathMap, Map<Long, String> stationPathMap) {
        if (blacklistedData == null || blacklistedData.isEmpty()) {
            return redListGrants;
        }

        // 直接使用预查询的黑名单数据，避免重复查询
        return redListGrants.stream()
            .filter(redGrant -> !isUserBlacklisted(redGrant, blacklistedData, orgPathMap, stationPathMap))
            .collect(Collectors.toList());
    }

    /**
     * 批量获取黑名单用户ID（使用组织路径信息）
     */
    private Map<String, Set<Long>> getBlacklistedUserIdsWithPath(List<PrivilegeGrantWithOrgPath> blackListGrants) {
        Set<Long> blacklistedUserIds = new HashSet<>();
        Map<String, Set<Long>> blacklistedData = new HashMap<>();

        // 收集所有需要查询的ID
        Set<Long> orgIds = new HashSet<>();
        Set<Long> positionIds = new HashSet<>();
        Set<Long> stationIds = new HashSet<>();

        for (PrivilegeGrantWithOrgPath blackGrant : blackListGrants) {
            if (blackGrant.getGrantToObjId() == null) {
                continue;
            }

            switch (blackGrant.getGrantToObjType()) {
                case "USER":
                    blacklistedUserIds.add(blackGrant.getGrantToObjId());
                    break;
                case "ORG":
                    orgIds.add(blackGrant.getGrantToObjId());
                    break;
                case "POST":
                    positionIds.add(blackGrant.getGrantToObjId());
                    break;
                case "STATION":
                    stationIds.add(blackGrant.getGrantToObjId());
                    break;
                default:
                    break;
            }
        }

        // 一次性批量查询所有类型的用户
        if (!orgIds.isEmpty() || !positionIds.isEmpty() || !stationIds.isEmpty()) {
            Set<Long> batchUserIds = getUsersInBatch(orgIds, positionIds, stationIds);
            blacklistedUserIds.addAll(batchUserIds);
        }

        blacklistedData.put("USER", blacklistedUserIds);
        blacklistedData.put("ORG", orgIds);
        blacklistedData.put("POST", positionIds);
        blacklistedData.put("STATION", stationIds);

        return blacklistedData;
    }

    /**
     * 从路径映射中获取指定ID列表对应的路径列�?
     */
    private Set<String> getPathsFromMap(Set<Long> ids, Map<Long, String> pathMap) {
        Set<String> paths = new HashSet<>();

        for (Long id : ids) {
            String path = pathMap.get(id);
            if (path != null) {
                paths.add(path);
            }
        }

        return paths;
    }

    /**
     * 通用的路径黑名单检查方�?
     */
    private boolean isPathBlacklisted(String currentPath, Set<Long> blacklistedIds, Map<Long, String> pathMap) {
        if (currentPath == null) {
            return false;
        }

        // 获取黑名单的路径列表
        Set<String> blacklistedPaths = getPathsFromMap(blacklistedIds, pathMap);

        // 检查直接路径匹�?
        if (!blacklistedPaths.isEmpty() && blacklistedPaths.contains(currentPath)) {
            return true;
        }

        // 检查子级路径匹配（使用统一的路径判断逻辑�?
        for (String blacklistedPath : blacklistedPaths) {
            if (blacklistedPath != null && currentPath.startsWith("." + blacklistedPath + ".")) {
                return true;
            }
        }

        return false;
    }

    /**
     * 按资源ID分组获取黑名单数据（避免不同资源间的黑名单混淆） 返回格式：Map<资源ID, Map<黑名单类�? Set<ID>>> 黑名单类型：USER, ORG, POSITION, LOCATION
     */
    private Map<Long, Map<String, Set<Long>>> getBlacklistedUserIdsByResource(
        Map<Long, List<PrivilegeGrantWithOrgPath>> allGrantsMap) {
        Map<Long, Map<String, Set<Long>>> blacklistedDataByResource = new HashMap<>();

        // 为每个资源获取其对应的黑名单数据
        for (Map.Entry<Long, List<PrivilegeGrantWithOrgPath>> entry : allGrantsMap.entrySet()) {
            Long resourceId = entry.getKey();
            List<PrivilegeGrantWithOrgPath> resourceGrants = entry.getValue();

            // 提取该资源的黑名单记�?
            List<PrivilegeGrantWithOrgPath> blackListGrants = resourceGrants.stream()
                .filter(grant -> "BLACK".equals(grant.getGrantToType())).collect(Collectors.toList());

            // 获取该资源的黑名单数据（按类型分组）
            Map<String, Set<Long>> blacklistedData = getBlacklistedUserIdsWithPath(blackListGrants);
            blacklistedDataByResource.put(resourceId, blacklistedData);
        }

        return blacklistedDataByResource;
    }

    /**
     * 一次性批量查询组织、岗位、驻地下的用户（减少数据库访问次数）
     */
    private Set<Long> getUsersInBatch(Set<Long> orgIds, Set<Long> positionIds, Set<Long> stationIds) {
        if (orgIds.isEmpty() && positionIds.isEmpty() && stationIds.isEmpty()) {
            return new HashSet<>();
        }

        // 使用一次UNION查询获取所有用�?
        List<Long> userIds = usersOrganizationMapper.selectUsersInBatch(orgIds, positionIds, stationIds);
        return new HashSet<>(userIds);
    }

    /**
     * 从红黑名单授权记录分析权限范�?
     */
    private PermissionScopeResult analyzeScopeFromGrants(List<PrivilegeGrant> redListGrants,
        List<PrivilegeGrant> blackListGrants) {

        // 1. 先处理黑名单，从红名单中移除被黑名单影响的授�?
        List<PrivilegeGrant> effectiveRedListGrants = removeBlacklistedGrants(redListGrants, blackListGrants);

        // 2. 基于处理后的红名单分析权限范�?
        return analyzeEffectiveScope(effectiveRedListGrants);
    }

    /**
     * 从红名单中移除被黑名单影响的授权
     */
    private List<PrivilegeGrant> removeBlacklistedGrants(List<PrivilegeGrant> redListGrants,
        List<PrivilegeGrant> blackListGrants) {

        if (CollectionUtils.isEmpty(blackListGrants)) {
            return redListGrants;
        }

        // 1. 获取黑名单组织、岗位、驻地下的人员ID
        Set<Long> blacklistedUserIds = getBlacklistedUserIds(blackListGrants);

        // 2. 从红名单中移除这些被黑名单影响的人员
        return redListGrants.stream().filter(redGrant -> !isUserBlacklisted(redGrant, blacklistedUserIds))
            .collect(Collectors.toList());
    }

    /**
     * 批量获取黑名单组织、岗位、驻地下的人员ID（优化版本，只查询一次数据库�?
     */
    private Set<Long> getBlacklistedUserIds(List<PrivilegeGrant> blackListGrants) {
        Set<Long> blacklistedUserIds = new HashSet<>();

        // 收集所有需要查询的ID
        Set<Long> orgIds = new HashSet<>();
        Set<Long> positionIds = new HashSet<>();
        Set<Long> stationIds = new HashSet<>();

        for (PrivilegeGrant blackGrant : blackListGrants) {
            // 先判断grantToObjId是否有�?
            if (blackGrant.getGrantToObjId() == null) {
                continue;
            }

            switch (blackGrant.getGrantToObjType()) {
                case "USER":
                    // 直接黑名单的用户
                    blacklistedUserIds.add(blackGrant.getGrantToObjId());
                    break;
                case "ORG":
                    // 收集组织ID，后续批量查�?
                    orgIds.add(blackGrant.getGrantToObjId());
                    break;
                case "POSI":
                    // 收集岗位ID，后续批量查�?
                    positionIds.add(blackGrant.getGrantToObjId());
                    break;
                case "STATION":
                    // 收集驻地ID，后续批量查�?
                    stationIds.add(blackGrant.getGrantToObjId());
                    break;
                default:
                    break;
            }
        }

        // 2. 批量查询组织下的用户（只查询一次）
        if (!orgIds.isEmpty()) {
            blacklistedUserIds.addAll(getUsersInOrgsBatch(orgIds));
        }

        // 3. 批量查询岗位下的用户（只查询一次）
        if (!positionIds.isEmpty()) {
            blacklistedUserIds.addAll(getUsersInPositionsBatch(positionIds));
        }

        // 4. 批量查询驻地下的用户（只查询一次）
        if (!stationIds.isEmpty()) {
            blacklistedUserIds.addAll(getUsersInLocationsBatch(stationIds));
        }

        return blacklistedUserIds;
    }

    /**
     * 判断红名单中的用户是否在黑名单中（使用预查询的黑名单数据�?true-表示在黑名单�?false-不在黑名单中
     */
    private boolean isUserBlacklisted(PrivilegeGrantWithOrgPath redGrant, Map<String, Set<Long>> blacklistedData,
        Map<Long, String> orgPathMap, Map<Long, String> stationPathMap) {
        // 先判断grantToObjId是否有�?
        if (redGrant.getGrantToObjId() == null) {
            return false;
        }

        // 检查当前授权对象是否在黑名单中
        Set<Long> blacklistedUserIds = blacklistedData.getOrDefault("USER", new HashSet<>());
        Set<Long> blacklistedOrgIds = blacklistedData.getOrDefault("ORG", new HashSet<>());
        Set<Long> blacklistedPositionIds = blacklistedData.getOrDefault("POST", new HashSet<>());
        Set<Long> blacklistedStationIds = blacklistedData.getOrDefault("STATION", new HashSet<>());

        // 根据授权对象类型检查是否在黑名单中
        switch (redGrant.getGrantToObjType()) {
            // 对于用户，直接判断是否在黑名单中，组织下、岗位下和驻地下的人
            case "USER":
                return blacklistedUserIds.contains(redGrant.getGrantToObjId());
            case "ORG":
                // 对于组织类型，需要检查组织路�?
                if (blacklistedOrgIds.contains(redGrant.getGrantToObjId())) {
                    return true;
                }
                return isPathBlacklisted(redGrant.getOrgPath(), blacklistedOrgIds, orgPathMap);
            case "POST":
                return blacklistedPositionIds.contains(redGrant.getGrantToObjId());
            case "STATION":
                // 对于驻地类型，需要检查驻地路�?
                if (blacklistedStationIds.contains(redGrant.getGrantToObjId())) {
                    return true;
                }
                return isPathBlacklisted(redGrant.getStationPath(), blacklistedStationIds, stationPathMap);
            default:
                return false;
        }
    }

    /**
     * 判断红名单中的用户是否在黑名单中
     */
    private boolean isUserBlacklisted(PrivilegeGrant redGrant, Set<Long> blacklistedUserIds) {
        // 先判断grantToObjId是否有�?
        if (redGrant.getGrantToObjId() == null) {
            return false;
        }

        // 只有用户类型的授权才需要检查是否在黑名单中
        if ("USER".equals(redGrant.getGrantToObjType())) {
            return blacklistedUserIds.contains(redGrant.getGrantToObjId());
        }

        // 对于组织、岗位、驻地类型的授权，需要获取其下的用户并检�?
        Set<Long> usersInGrant = new HashSet<>();
        switch (redGrant.getGrantToObjType()) {
            case "ORG":
                usersInGrant = getUsersInOrg(redGrant.getGrantToObjId());
                break;
            case "POST":
                usersInGrant = getUsersInPosition(redGrant.getGrantToObjId());
                break;
            case "STATION":
                usersInGrant = getUsersInLocation(redGrant.getGrantToObjId());
                break;
            default:
                break;
        }

        // 如果该授权下的所有用户都在黑名单中，则整个授权无�?
        return !usersInGrant.isEmpty() && blacklistedUserIds.containsAll(usersInGrant);
    }

    /**
     * 获取组织下的所有用户ID 注意：这里需要根据实际的数据库表结构来实�?示例实现，请根据实际情况修改�?1. 查询组织表获取所有子组织ID 2. 查询用户组织关系表获取这些组织下的所有用户ID
     */
    private Set<Long> getUsersInOrg(Long orgId) {
        // 先判断orgId是否有�?
        if (orgId == null) {
            return new HashSet<>();
        }

        // TODO: 根据实际数据库表结构实现
        // 示例SQL逻辑�?
        // SELECT DISTINCT user_id FROM user_org_relation
        // WHERE org_id IN (
        // SELECT org_id FROM org WHERE parent_org_id = #{orgId} OR org_id = #{orgId}
        // ) AND status_cd = 'A'

        // 临时返回空集合，需要根据实际表结构实现
        return new HashSet<>();
    }

    /**
     * 获取岗位下的所有用户ID 注意：这里需要根据实际的数据库表结构来实�?
     */
    private Set<Long> getUsersInPosition(Long positionId) {
        // 先判断positionId是否有�?
        if (positionId == null) {
            return new HashSet<>();
        }

        // TODO: 根据实际数据库表结构实现
        // 示例SQL逻辑�?
        // SELECT user_id FROM user_position_relation
        // WHERE position_id = #{positionId} AND status_cd = 'A'

        // 临时返回空集合，需要根据实际表结构实现
        return new HashSet<>();
    }

    /**
     * 获取驻地下的所有用户ID 注意：这里需要根据实际的数据库表结构来实�?
     */
    private Set<Long> getUsersInLocation(Long locationId) {
        // 先判断locationId是否有�?
        if (locationId == null) {
            return new HashSet<>();
        }

        // TODO: 根据实际数据库表结构实现
        // 示例SQL逻辑�?
        // SELECT user_id FROM user_location_relation
        // WHERE location_id = #{locationId} AND status_cd = 'A'

        // 临时返回空集合，需要根据实际表结构实现
        return new HashSet<>();
    }

    /**
     * 批量获取多个组织下的所有用户ID 注意：这里需要根据实际的数据库表结构来实�?
     */
    private Set<Long> getUsersInOrgsBatch(Set<Long> orgIds) {
        if (orgIds == null || orgIds.isEmpty()) {
            return new HashSet<>();
        }

        // TODO: 根据实际数据库表结构实现
        // 示例SQL逻辑�?
        // SELECT DISTINCT user_id FROM user_org_relation
        // WHERE org_id IN (#{orgIds}) AND status_cd = 'A'

        // 临时返回空集合，需要根据实际表结构实现
        return new HashSet<>();
    }

    /**
     * 批量获取多个岗位下的所有用户ID 注意：这里需要根据实际的数据库表结构来实�?
     */
    private Set<Long> getUsersInPositionsBatch(Set<Long> positionIds) {
        if (positionIds == null || positionIds.isEmpty()) {
            return new HashSet<>();
        }

        // TODO: 根据实际数据库表结构实现
        // 示例SQL逻辑�?
        // SELECT user_id FROM user_position_relation
        // WHERE position_id IN (#{positionIds}) AND status_cd = 'A'

        // 临时返回空集合，需要根据实际表结构实现
        return new HashSet<>();
    }

    /**
     * 批量获取多个驻地下的所有用户ID 注意：这里需要根据实际的数据库表结构来实�?
     */
    private Set<Long> getUsersInLocationsBatch(Set<Long> locationIds) {
        if (locationIds == null || locationIds.isEmpty()) {
            return new HashSet<>();
        }

        // TODO: 根据实际数据库表结构实现
        // 示例SQL逻辑�?
        // SELECT user_id FROM user_location_relation
        // WHERE location_id IN (#{locationIds}) AND status_cd = 'A'

        // 临时返回空集合，需要根据实际表结构实现
        return new HashSet<>();
    }

    /**
     * 基于有效的红名单分析权限范围
     */
    private PermissionScopeResult analyzeEffectiveScope(List<PrivilegeGrant> effectiveRedListGrants) {
        if (CollectionUtils.isEmpty(effectiveRedListGrants)) {
            return new PermissionScopeResult(PermissionScope.PERSONAL_ONLY, "无有效授权，仅创建者可见");
        }

        // 检查是否有全公司授权（parent_org_id�?1的组织）
        boolean hasCompanyWideAccess = effectiveRedListGrants.stream().anyMatch(
            grant -> "ORG".equals(grant.getGrantToObjType()) && isCompanyWideOrganization(grant.getGrantToObjId()));

        if (hasCompanyWideAccess) {
            return new PermissionScopeResult(PermissionScope.COMPANY_WIDE, "全公司可见");
        }

        // 检查是否只有个人授�?
        boolean onlyPersonalAccess = effectiveRedListGrants.stream()
            .allMatch(grant -> "USER".equals(grant.getGrantToObjType()));

        if (onlyPersonalAccess && effectiveRedListGrants.size() == 1) {
            return new PermissionScopeResult(PermissionScope.PERSONAL_ONLY, "仅个人可见");
        }

        // 其他情况都是部分可见
        return new PermissionScopeResult(PermissionScope.PARTIAL, "部分组织/人员可见");
    }

    /**
     * 判断是否为全公司组织（parent_org_id�?1�?
     */
    private boolean isCompanyWideOrganization(Long orgId) {
        if (orgId == null) {
            return false;
        }

        Organization org = organizationMapper.selectById(orgId);
        return org != null && org.getParentOrgId() != null && org.getParentOrgId() == -1L;
    }

    /**
     * 获取指定用户对指定资源的权限范围
     *
     * @param userId 用户ID
     * @param resourceId 资源ID
     * @param resourceType 资源类型
     * @return 用户是否有权限访问该资源
     */
    public boolean hasUserPermission(Long userId, Long resourceId, String resourceType) {
        // 1. 查询用户信息
        Users user = usersMapper.selectById(userId);
        if (user == null) {
            return false;
        }

        // 2. 查询用户所属组�?
        List<UsersOrganization> userOrgs = queryUserOrganizations(userId);
        Set<Long> userOrgIds = userOrgs.stream().map(UsersOrganization::getOrgId).collect(Collectors.toSet());

        // 3. 查询资源授权记录
        List<PrivilegeGrant> grants = queryResourceGrants(resourceId, resourceType);

        if (CollectionUtils.isEmpty(grants)) {
            return false; // 无授权记录，无权�?
        }

        // 4. 检查红名单
        boolean inRedList = grants.stream().filter(grant -> "RED".equals(grant.getGrantToType())).anyMatch(grant -> {
            if ("USER".equals(grant.getGrantToObjType())) {
                return userId.equals(grant.getGrantToObjId());
            }
            else if ("ORG".equals(grant.getGrantToObjType())) {
                return userOrgIds.contains(grant.getGrantToObjId())
                    || isUserInSubOrganization(userId, grant.getGrantToObjId());
            }
            return false;
        });

        if (!inRedList) {
            return false; // 不在红名单中，无权限
        }

        // 5. 检查黑名单
        boolean inBlackList = grants.stream().filter(grant -> "BLACK".equals(grant.getGrantToType()))
            .anyMatch(grant -> {
                if ("USER".equals(grant.getGrantToObjType())) {
                    return userId.equals(grant.getGrantToObjId());
                }
                else if ("ORG".equals(grant.getGrantToObjType())) {
                    return userOrgIds.contains(grant.getGrantToObjId())
                        || isUserInSubOrganization(userId, grant.getGrantToObjId());
                }
                return false;
            });

        return !inBlackList; // 在黑名单中则无权�?
    }

    /**
     * 查询用户所属组�?
     */
    private List<UsersOrganization> queryUserOrganizations(Long userId) {
        LambdaQueryWrapper<UsersOrganization> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(UsersOrganization::getUserId, userId);
        return usersOrganizationMapper.selectList(queryWrapper);
    }

    /**
     * 判断用户是否在指定组织的下级组织�?
     */
    private boolean isUserInSubOrganization(Long userId, Long orgId) {
        // 查询指定组织的路�?
        Organization org = organizationMapper.selectById(orgId);
        if (org == null || org.getPathCode() == null) {
            return false;
        }

        // 查询用户所属组�?
        List<UsersOrganization> userOrgs = queryUserOrganizations(userId);

        // 检查用户是否在指定组织的下级组织中
        return userOrgs.stream().anyMatch(userOrg -> {
            Organization userOrganization = organizationMapper.selectById(userOrg.getOrgId());
            return userOrganization != null && userOrganization.getPathCode() != null
                && userOrganization.getPathCode().startsWith(org.getPathCode() + ".");
        });
    }

    /**
     * 权限范围分析结果
     */
    public static class PermissionScopeResult {
        private final PermissionScope scope;

        private final int scopeCode;

        private final String description;

        private final List<String> details;

        public PermissionScopeResult(PermissionScope scope, String description) {
            this.scope = scope;
            this.scopeCode = scope != null ? scope.getCode() : 1;
            this.description = description;
            this.details = new ArrayList<>();
        }

        public PermissionScopeResult(PermissionScope scope, String description, List<String> details) {
            this.scope = scope;
            this.scopeCode = scope != null ? scope.getCode() : 1;
            this.description = description;
            this.details = details;
        }

        public PermissionScope getScope() {
            return scope;
        }

        public int getScopeCode() {
            return scopeCode;
        }

        public String getDescription() {
            return description;
        }

        public List<String> getDetails() {
            return details;
        }

        @Override
        public String toString() {
            return "PermissionScopeResult{" + "scope=" + scope + ", scopeCode=" + scopeCode + ", description='"
                + description + '\'' + ", details=" + details + '}';
        }
    }
}