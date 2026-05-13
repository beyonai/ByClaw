package com.iwhalecloud.byai.manager.domain.organization.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantToObjType;
import com.iwhalecloud.byai.manager.domain.event.organization.OrganizationDeletedEvent;
import com.iwhalecloud.byai.manager.domain.event.organization.OrganizationUpdatedEvent;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.domain.users.service.UsersOrganizationExternalSystemService;
import com.iwhalecloud.byai.manager.domain.users.service.UsersOrganizationService;
import com.iwhalecloud.byai.manager.dto.openapi.BelongOrgManagerDTO;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.organization.OrgExternalSystem;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import com.iwhalecloud.byai.manager.infrastructure.cache.ShareCacheUtil;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.mapper.organization.OrganizationMapper;
import com.iwhalecloud.byai.manager.qo.organization.OrgManagerQo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.cache.ShareBfmUser;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.constants.users.OrgType;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.vo.organization.BelongOrgManagerVo;
import com.iwhalecloud.byai.manager.vo.organization.OrgManagerVo;
import com.iwhalecloud.byai.common.constants.Constants;

/**
 * 组织服务接口
 */
@Service
public class OrganizationService {

    private static final Logger logger = LoggerFactory.getLogger(OrganizationService.class);


    @Autowired
    private OrganizationMapper organizationMapper;

    @Autowired
    private ApplicationEventPublisher eventPublisher;

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private UsersOrganizationService usersOrganizationService;

    @Autowired
    private OrgExternalSystemService orgExternalSystemService;

    @Autowired
    private UsersOrganizationExternalSystemService usersOrganizationExternalSystemService;

    @Autowired
    private PrivilegeGrantMapper privilegeGrantMapper;

    /**
     * 查找组织
     *
     * @param orgId 查询组织
     * @return Organization
     */
    public Organization findById(Long orgId) {
        return organizationMapper.selectById(orgId);
    }

    /***
     * 新增组织
     *
     * @param organization 新增组织
     */
    public void addOrg(Organization organization) {

        Long count = organizationMapper.countDuplicate(organization.getOrgName(), null, null);
        if (count > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("org.name.duplicate"));
        }

        count = organizationMapper.countDuplicate(null, organization.getOrgCode(), null);
        if (count > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("org.code.duplicate"));
        }

        organization.setOrgId(SequenceService.nextVal());
        organization.setCreateDate(new Date());
        organization.setOrgType(OrgType.INNER_ORG);
        organization.setParentOrgId(organization.getParentOrgId() != null ? organization.getParentOrgId() : -1L);

        // 设置pathCode路径参数
        if (organization.getParentOrgId() <= 0) {
            organization.setOrgLevel(0);
            organization.setPathCode("-1." + organization.getOrgId());
        }
        else {
            Organization parentOrganization = organizationMapper.selectById(organization.getParentOrgId());
            organization.setOrgLevel(parentOrganization.getOrgLevel() + 1);
            organization.setPathCode(parentOrganization.getPathCode() + "." + organization.getOrgId());
        }

        organizationMapper.insert(organization);

    }

    /**
     * 更新组织
     *
     * @param organization 组织信息
     */
    public Organization updateOrg(Organization organization) {

        if (!(CurrentUserHolder.isPlatformManager() || this.isOrganizationManManager(organization.getParentOrgId()))) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("org.update.permission.deny"));
        }

        // 检查是否重�?
        Long count = organizationMapper.countDuplicate(organization.getOrgName(), null, organization.getOrgId());
        if (count > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("org.name.duplicate"));
        }
        count = organizationMapper.countDuplicate(null, organization.getOrgCode(), organization.getOrgId());
        if (count > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("org.code.duplicate"));
        }

        Organization updateOrganization = organizationMapper.selectById(organization.getOrgId());
        if (updateOrganization == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("org.not.exist"));
        }

        updateOrganization.setOrgName(organization.getOrgName());
        updateOrganization.setOrgCode(organization.getOrgCode());
        updateOrganization.setOrgIndex(organization.getOrgIndex());
        updateOrganization.setOrgDesc(organization.getOrgDesc());
        updateOrganization.setUpdateDate(new Date());
        organizationMapper.updateById(updateOrganization);

        // 发布组织更新事件
        eventPublisher.publishEvent(new OrganizationUpdatedEvent(this, updateOrganization));

        return updateOrganization;
    }

    /**
     * 删除组织l
     *
     * @param orgId 组织标识
     */
    public void delOrg(Long orgId) {

        // 检查父
        Long count = organizationMapper.countByParentOrgId(orgId);
        if (count > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("org.has.child"));
        }

        // 检查组织是否存在用�?
        count = organizationMapper.countUsersByOrgId(orgId);
        if (count > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("org.has.user"));
        }

        // 删除组织前清理相关缓�?
        clearOrganizationCache(orgId);

        // 删除组织前清理相关授权给组织的权限数�?
        clearOrganizationPrivilegeData(orgId);

        organizationMapper.deleteById(orgId);

        // 发布组织删除事件
        eventPublisher.publishEvent(new OrganizationDeletedEvent(this, orgId));

    }

    public Long getFirstOrgId() {
        return organizationMapper.getFirstOrgId();
    }

    /**
     * 判断当前用户是否是某个组织的管理�?
     *
     * @return boolean
     */
    public boolean isOrganizationManManager(Long operateOrgId) {

        List<com.iwhalecloud.byai.common.login.bean.UsersOrganization> usersOrganizations = CurrentUserHolder
            .getUsersOrganizations();
        if (usersOrganizations == null || usersOrganizations.isEmpty()) {
            return false;
        }

        Organization operateOrganization = this.findById(operateOrgId);

        // 查看当前用户是否是组织管理员
        for (com.iwhalecloud.byai.common.login.bean.UsersOrganization usersOrganization : usersOrganizations) {

            String userType = usersOrganization.getUserType();
            String pathCode = usersOrganization.getPathCode();

            // 用户是当前组织的管理�?
            if (UserType.ORG_MAN.equals(userType) && operateOrgId.equals(usersOrganization.getOrgId())) {
                return true;
            }

            // 查询当前组织的pathCode,和当前用户的所在所有组织的pathCode对比，如果是父组织管理员也可以操作当前组�?
            if (operateOrganization == null) {
                continue;
            }

            // 如新当前组织是组织管理员所在组织的子组织，-1.1管理员可以操�?1.1.2
            if (UserType.ORG_MAN.equals(userType) && operateOrganization.getPathCode().startsWith(pathCode)) {
                return true;
            }
        }
        return false;
    }

    public Map<String, Object> getOrganizationManManager() {
        Map<String, Object> res = new HashMap<>();
        List<Long> orgIds = new ArrayList<>();
        List<com.iwhalecloud.byai.common.login.bean.UsersOrganization> usersOrganizations = CurrentUserHolder
            .getUsersOrganizations();
        for (com.iwhalecloud.byai.common.login.bean.UsersOrganization usersOrganization : usersOrganizations) {
            if (UserType.ORG_MAN.equals(usersOrganization.getUserType())) {
                orgIds.add(usersOrganization.getOrgId());
            }
        }
        res.put("orgIds", orgIds);
        res.put("userType", CurrentUserHolder.getHighestUserType());
        return res;
    }

    /**
     * 查询组织下的归属管理�?
     *
     * @param orgManagerQo 组织归属管理�?
     * @return List<OrgManagerVo>
     */
    public List<OrgManagerVo> qryOrgManager(OrgManagerQo orgManagerQo) {
        orgManagerQo.setUserTypes(List.of(UserType.ORG_MAN));
        return organizationMapper.qryByUserType(orgManagerQo);
    }

    /**
     * 分页查询组织信息
     *
     * @param page 分页信息
     * @param queryWrapper 查询对象
     * @return List<Users>
     */
    public List<Organization> selectList(IPage<Organization> page, Wrapper<Organization> queryWrapper) {
        return organizationMapper.selectList(page, queryWrapper);
    }

    /**
     * 查询组织下的归属管理�?
     *
     * @param userId 查询户所在的组织
     * @return List<Organization>
     */
    public List<Organization> findOrganizationByUserId(Long userId) {
        return organizationMapper.findOrganizationByUserId(userId);
    }

    /**
     * 查询用户关联的组织信�?
     *
     * @param userId 用户标识
     * @return UsersOrganization
     */
    public List<com.iwhalecloud.byai.common.login.bean.UsersOrganization> findUsersOrganizationByUserId(
        Long userId) {
        return organizationMapper.getUsersOrganization(userId);
    }

    /**
     * @param orgManagerQo 查询发布的组织列�?
     * @return ResponseUtil
     */
    public List<OrgManagerVo> getPublishByOrgId(OrgManagerQo orgManagerQo) {
        orgManagerQo.setUserTypes(List.of(UserType.ORG_MAN, UserType.BUSINESS_MAN));
        return organizationMapper.qryByUserType(orgManagerQo);
    }

    public List<Long> getCurrentAndBeyondOrgIdList(List<Long> orgIdList) {
        return organizationMapper.getCurrentAndBeyondOrgIdList(orgIdList);
    }

    /**
     * 构建组织路径，将path_code=-1.1.2.7.11.12转成组织名称返回
     *
     * @param orgIds 组织标识
     * @return String
     */
    public String buildPathNameByOrgIds(List<Long> orgIds) {
        if (ListUtil.isEmpty(orgIds)) {
            return null;
        }

        Map<Long, String> pathNameMap = new HashMap<Long, String>(10);
        for (Long orgId : orgIds) {

            Organization organization = this.findById(orgId);
            List<String> pathNameList = new ArrayList<>(5);
            while (organization != null) {
                // 倒序添加到组织路径中
                pathNameList.add(organization.getOrgName());

                organization = this.findById(organization.getParentOrgId());
            }

            // 顺序
            Collections.reverse(pathNameList);
            pathNameMap.put(orgId, StringUtils.join(pathNameList, "-"));
        }

        // 获取所有组织路径，多个用客格分�?
        return StringUtils.join(pathNameMap.values(), " ");
    }

    /**
     * 更新组织信息
     *
     * @param organization 组织信息
     */
    public void save(Organization organization) {
        organization.setCreateDate(new Date());
        organizationMapper.insert(organization);
    }

    /**
     * 更新组织信息
     *
     * @param organization 组织信息
     */
    public void update(Organization organization) {
        organization.setUpdateDate(new Date());
        organizationMapper.updateById(organization);
    }

    /**
     * 更新组织信息
     *
     * @param orgId 组织信息
     */
    public void deleteById(Long orgId) {
        organizationMapper.deleteById(orgId);
    }

    /**
     * 优先从缓存中查询组织信息
     *
     * @param orgId 组织标识
     * @return String
     */
    public String getCacheOrgName(Long orgId) {

        Organization organization = ShareCacheUtil.getShareOrganization(orgId);

        if (organization != null) {
            return organization.getOrgName();
        }

        organization = this.findById(orgId);
        return organization != null ? organization.getOrgName() : null;
    }

    /**
     * 清理组织删除时的相关缓存
     *
     * @param orgId 组织标识
     */
    private void clearOrganizationCache(Long orgId) {
        // 1. 清理组织基础信息缓存
        clearOrganizationBasicCache(orgId);

        // 2. 清理用户组织关联缓存
        clearUserOrganizationCache(orgId);

        // 3. 更新用户基础信息缓存中的组织ID
        updateUserBasicInfoCache(orgId);

        // 4. 清理权限相关缓存
        clearOrganizationPrivilegeCache(orgId);
    }

    /**
     * 清理组织基础信息缓存
     *
     * @param orgId 组织标识
     */
    private void clearOrganizationBasicCache(Long orgId) {
        String orgCacheKey = Constants.SHARE_ORGANIZATION + orgId;
        RedisUtil.removeKey(orgCacheKey);
        logger.info("组织基础信息缓存已清�? orgId={}, cacheKey={}", orgId, orgCacheKey);
    }

    /**
     * 清理用户组织关联缓存
     *
     * @param orgId 组织标识
     */
    private void clearUserOrganizationCache(Long orgId) {
        try {
            // 查询所有关联该组织的用�?
            List<UsersOrganization> usersOrganizations = usersOrganizationService.findByOrgId(orgId);

            for (UsersOrganization usersOrg : usersOrganizations) {
                Long userId = usersOrg.getUserId();
                String userOrgCacheKey = Constants.SHARE_USER_ORG_POST + userId;
                String cacheData = RedisUtil.getString(userOrgCacheKey);

                if (StringUtil.isEmpty(cacheData)) {
                    continue;
                }

                try {
                    // 解析用户组织关联数据
                    JSONArray usersOrgArray = JSONArray.parseArray(cacheData);
                    JSONArray updatedArray = new JSONArray();

                    // 过滤掉被删除的组�?
                    for (int i = 0; i < usersOrgArray.size(); i++) {
                        JSONObject userOrgJson = usersOrgArray.getJSONObject(i);
                        Long cachedOrgId = userOrgJson.getLong("orgId");
                        if (!orgId.equals(cachedOrgId)) {
                            updatedArray.add(userOrgJson);
                        }
                    }

                    // 更新缓存
                    if (updatedArray.isEmpty()) {
                        RedisUtil.removeKey(userOrgCacheKey);
                    }
                    else {
                        RedisUtil.setString(userOrgCacheKey, updatedArray.toJSONString());
                    }

                    logger.info("用户组织关联缓存已更�? userId={}, removedOrgId={}", userId, orgId);
                }
                catch (Exception e) {
                    logger.error("更新用户组织关联缓存失败: userId={}, error={}", userId, e.getMessage(), e);
                }
            }
        }
        catch (Exception e) {
            logger.error("清理用户组织关联缓存时发生异�? orgId={}, error={}", orgId, e.getMessage(), e);
        }
    }

    /**
     * 更新用户基础信息缓存中的组织ID
     *
     * @param orgId 组织标识
     */
    private void updateUserBasicInfoCache(Long orgId) {
        try {
            // 查询所有关联该组织的用�?
            List<UsersOrganization> usersOrganizations = usersOrganizationService.findByOrgId(orgId);

            for (UsersOrganization usersOrg : usersOrganizations) {
                Long userId = usersOrg.getUserId();
                String userCacheKey = Constants.SHARE_BFM_USER + userId;
                String cacheData = RedisUtil.getString(userCacheKey);

                if (StringUtil.isEmpty(cacheData)) {
                    continue;
                }

                try {
                    ShareBfmUser shareBfmUser = JSON.parseObject(cacheData, ShareBfmUser.class);
                    if (shareBfmUser != null && orgId.equals(shareBfmUser.getOrgId())) {
                        // 将组织ID置空或设置为默认�?
                        shareBfmUser.setOrgId(null);
                        RedisUtil.setString(userCacheKey, JSON.toJSONString(shareBfmUser));
                        logger.info("用户基础信息缓存已更�? userId={}, clearedOrgId={}", userId, orgId);
                    }
                }
                catch (Exception e) {
                    logger.error("更新用户基础信息缓存失败: userId={}, error={}", userId, e.getMessage(), e);
                }
            }
        }
        catch (Exception e) {
            logger.error("更新用户基础信息缓存时发生异�? orgId={}, error={}", orgId, e.getMessage(), e);
        }
    }

    /**
     * 清理组织相关的权限缓�?
     *
     * @param orgId 组织标识
     */
    private void clearOrganizationPrivilegeCache(Long orgId) {
        clearUsePrivilegeCache(orgId);
        logger.info("组织权限缓存清理完成: orgId={}", orgId);
    }

    /**
     * 清理组织相关的权限数�?删除组织时需要清理以下权限数据： 授权给该组织的权限记�?(grant_to_obj_type = 'ORG' AND grant_to_obj_id = orgId)
     *
     * @param orgId 组织标识
     */
    private void clearOrganizationPrivilegeData(Long orgId) {
        try {
            logger.info("开始清理组织权限数�? orgId={}", orgId);

            // 清理授权给该组织的权限记�?
            clearPrivilegesGrantedToOrganization(orgId);

            logger.info("组织权限数据清理完成: orgId={}", orgId);
        }
        catch (Exception e) {
            logger.error("清理组织权限数据失败: orgId={}, error={}", orgId, e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("org.clean.permission.data.failed", e.getMessage()));
        }
    }

    /**
     * 清理授权给该组织的权限记�?清理条件：grant_to_obj_type = 'ORG' AND grant_to_obj_id = orgId
     *
     * @param orgId 组织标识
     */
    private void clearPrivilegesGrantedToOrganization(Long orgId) {
        LambdaQueryWrapper<PrivilegeGrant> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(PrivilegeGrant::getGrantToObjType, GrantToObjType.ORG);
        queryWrapper.eq(PrivilegeGrant::getGrantToObjId, orgId);
        queryWrapper.eq(PrivilegeGrant::getStatusCd, "A");

        List<PrivilegeGrant> privilegeGrants = privilegeGrantMapper.selectList(queryWrapper);
        if (ListUtil.isNotEmpty(privilegeGrants)) {
            for (PrivilegeGrant privilegeGrant : privilegeGrants) {
                privilegeGrant.setStatusCd("X");
                privilegeGrant.setUpdateDate(new Date());
                privilegeGrant.setUpdateStaff(CurrentUserHolder.getCurrentUserId());
                privilegeGrantMapper.updateById(privilegeGrant);
            }
            logger.info("已清理授权给组织的权限记�? orgId={}, count={}", orgId, privilegeGrants.size());
        }
    }

    /**
     * 清理使用权限缓存
     *
     * @param orgId 组织标识
     */
    private void clearUsePrivilegeCache(Long orgId) {
        try {
            // 清理使用权限缓存
            // 格式: DATASET:AUTHORITY:{range}_{color}_{operation}_ORGANIZATION_{orgId}
            String[] ranges = {
                "1", "2", "3"
            }; // 授权范围
            String[] colors = {
                "RED", "BLACK"
            }; // 红黑名单
            String[] operations = {
                "READ", "WRITE"
            }; // 读写权限

            for (String range : ranges) {
                for (String color : colors) {
                    for (String operation : operations) {
                        String usePrivKey = String.format("DATASET:AUTHORITY:%s_%s_%s_ORGANIZATION_%d", range, color,
                            operation, orgId);
                        RedisUtil.removeKey(usePrivKey);
                        logger.info("使用权限缓存已清�? {}", usePrivKey);
                    }
                }
            }
        }
        catch (Exception e) {
            logger.error("清理使用权限缓存失败: orgId={}, error={}", orgId, e.getMessage(), e);
        }
    }

    /***
     * 查询组织的所有归属管理员(包括父级)
     *
     * @param belongOrgManagerDTO 组织标识
     * @return List
     */
    public List<BelongOrgManagerVo> qryAllBelongOrgManagers(BelongOrgManagerDTO belongOrgManagerDTO) {
        return organizationMapper.qryAllBelongOrgManagers(belongOrgManagerDTO);
    }

    /**
     * 批量查询组织信息（包含路径名称），使用单次SQL查询 这是性能最优的查询方式，使用递归CTE一次性获取所有组织及其完整路�?
     *
     * @param orgIds 组织ID列表
     * @return Map<Long, Map < String, Object>> 组织ID到组织信息的映射
     */
    public List<Map<String, Object>> findOrganizationsWithPathNames(List<Long> orgIds) {
        if (ListUtil.isEmpty(orgIds)) {
            return new ArrayList<>();
        }
        return organizationMapper.selectOrganizationsWithPathNames(orgIds);
    }

    /**
     * 清理组织相关的外部系统映射数�?删除组织时需要清理以下外部系统映射表�?1. po_users_organization_external_system - 用户组织关系的外部系统映�?2.
     * po_org_external_system - 组织本身的外部系统映�?
     *
     * @param orgId 组织标识
     */
    public void clearOrganizationExternalSystemData(Long orgId) {
        try {
            logger.info("开始清理组织外部系统映射数�? orgId={}", orgId);

            // 1. 清理表：po_users_organization_external_system
            // 删除该组织下所有用户组织关系的外部系统映射记录
            clearUsersOrganizationExternalSystemData(orgId);

            // 2. 清理表：po_org_external_system
            // 删除组织本身的外部系统映射记�?
            clearOrgExternalSystemData(orgId);

            logger.info("组织外部系统映射数据清理完成: orgId={}", orgId);
        }
        catch (Exception e) {
            logger.error("清理组织外部系统映射数据失败: orgId={}, error={}", orgId, e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("org.clean.external.system.mapping.failed", e.getMessage()));
        }
    }

    /**
     * 清理用户组织关系的外部系统映射数�?清理表：po_users_organization_external_system 删除该组织下所有用户组织关系的外部系统映射记录
     *
     * @param orgId 组织标识
     */
    private void clearUsersOrganizationExternalSystemData(Long orgId) {
        // 查询该组织下的所有用户组织关�?
        List<UsersOrganization> usersOrganizations = usersOrganizationService.findByOrgId(orgId);

        if (usersOrganizations == null || usersOrganizations.isEmpty()) {
            logger.info("该组织下没有用户组织关系，跳过用户组织关系外部系统映射清�? orgId={}", orgId);
            return;
        }

        for (UsersOrganization usersOrg : usersOrganizations) {
            // 删除用户组织关系的外部系统映�?
            usersOrganizationExternalSystemService.deleteByUsersOrganizationId(usersOrg.getId());
            logger.info("用户组织关系外部系统映射已删�? usersOrganizationId={}, orgId={}", usersOrg.getId(), orgId);
        }
        logger.info("用户组织关系外部系统映射清理完成: orgId={}, 清理数量={}", orgId, usersOrganizations.size());
    }

    /**
     * 清理组织外部系统映射数据 清理表：po_org_external_system 删除组织本身的外部系统映射记�?
     *
     * @param orgId 组织标识
     */
    private void clearOrgExternalSystemData(Long orgId) {
        // 根据组织ID查找外部系统映射记录
        OrgExternalSystem orgExternalSystem = orgExternalSystemService.findByOrgId(orgId);

        if (orgExternalSystem == null) {
            logger.info("未找到组织外部系统映射记录，跳过清理: orgId={}", orgId);
            return;
        }

        // 删除组织外部系统映射
        orgExternalSystemService.deleteById(orgExternalSystem.getPoOrgExternalSystemId());
        logger.info("组织外部系统映射已删�? poOrgExternalSystemId={}, orgId={}", orgExternalSystem.getPoOrgExternalSystemId(),
            orgId);

        logger.info("组织外部系统映射清理完成: orgId={}", orgId);
    }


    public List<Long> getTopOrgList() {
        return organizationMapper.getTopOrgList();
    }
}