package com.iwhalecloud.byai.manager.application.service.organization;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.StrUtil;
import com.iwhalecloud.byai.manager.domain.event.organization.OrganizationCreatedEvent;
import com.iwhalecloud.byai.manager.domain.event.organization.OrganizationDeletedEvent;
import com.iwhalecloud.byai.manager.domain.event.organization.OrganizationUpdatedEvent;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.domain.users.service.UsersOrganizationService;
import com.iwhalecloud.byai.manager.dto.organization.AddUserByOrgDTO;
import com.iwhalecloud.byai.manager.dto.organization.UserOrOrgDTO;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.infrastructure.cache.ShareCacheUtil;
import com.iwhalecloud.byai.manager.mapper.organization.OrganizationMapper;
import com.iwhalecloud.byai.manager.qo.organization.OrgTreeQo;
import com.iwhalecloud.byai.manager.qo.organization.SearchOrgQo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.manager.vo.organization.OrgTreeVo;
import com.iwhalecloud.byai.manager.vo.organization.OrganizationVo;
import org.apache.commons.collections.CollectionUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 组织应用服务
 */
@Service
public class OrganizationApplicationService {

    @Autowired
    private OrganizationMapper organizationMapper;

    @Autowired
    private UserService userService;

    @Autowired
    private ApplicationEventPublisher eventPublisher;

    @Autowired
    private UsersOrganizationService usersOrganizationService;

    @Autowired
    private OrganizationService organizationService;

    /**
     * 查询组织
     *
     * @param searchOrgQo 入参
     * @return 组织视图对象
     */
    public OrganizationVo searchOrg(SearchOrgQo searchOrgQo) {
        return organizationMapper.searchOrg(searchOrgQo);
    }

    /**
     * 查询组织树
     *
     * @param orgTreeQo 入参
     * @return 组织树视图对象列表
     */
    public List<OrgTreeVo> getOrgTree(OrgTreeQo orgTreeQo) {

        // 勾选我的组织，通过线程变量获取当前登陆用户的组织列表
        if ("1".equals(orgTreeQo.getMyFlag())) {
            List<UsersOrganization> userOrgList = CurrentUserHolder.getUsersOrganizations();
            if (CollectionUtils.isNotEmpty(userOrgList)) {
                orgTreeQo.setOrgIds(userOrgList.stream().map(UsersOrganization::getOrgId).collect(Collectors.toList()));
            }
        }
        List<OrgTreeVo> orgTree = organizationMapper.getOrgTree(orgTreeQo);

        // 如果不需要返回上级组织信息，直接返回
        if (orgTree.isEmpty() || !orgTreeQo.isContainsParent()) {
            return orgTree;
        }

        // 查询当前组织信息，包含上级组织信息一起返回
        Set<Long> orgIds = new HashSet<>(100);
        for (OrgTreeVo orgTreeVo : orgTree) {
            String pathCode = orgTreeVo.getPathCode();
            if (StringUtil.isEmpty(pathCode)) {
                continue;
            }
            String[] split = pathCode.split("\\.");
            for (String orgIdStr : split) {
                orgIds.add(Long.parseLong(orgIdStr));
            }
        }
        return organizationMapper.getOrgTree(new OrgTreeQo(orgIds));
    }

    /***
     * 从组织中选择成员添加
     *
     * @param addUserByOrgDTO 新增对象
     * @return ResponseUtil
     */
    public ResponseUtil addUserByOrg(AddUserByOrgDTO addUserByOrgDTO) {

        Long orgId = addUserByOrgDTO.getOrgId();
        List<String> userTypeList = getUserTypeListAndValidate(addUserByOrgDTO);
        Long positionId = addUserByOrgDTO.getPositionId();
        List<UserOrOrgDTO> userOrOrgVos = addUserByOrgDTO.getUserOrOrgVos();
        for (int i = 0; userOrOrgVos != null && i < userOrOrgVos.size(); i++) {
            UserOrOrgDTO userOrOrgDTO = userOrOrgVos.get(i);
            Long objectId = userOrOrgDTO.getObjectId();
            String objectType = userOrOrgDTO.getObjectType();

            // 如果添加类型是组织，查询组织下面的用户标识挂载
            if (UserOrOrgDTO.ORG.equals(objectType)) {
                Organization organization = organizationService.findById(objectId);
                if (organization == null) {
                    throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                            "[" + i + "]:" + I18nUtil.get("organization.add.invalid.organization"));
                }

                List<Long> userIds = userService.findUserIdsByOrgId(objectId);
                this.batchHandleUsersOrganization(orgId, userTypeList, positionId, userIds);
            }
            else if (UserOrOrgDTO.USER.equals(objectType)) {
                Users users = userService.findById(objectId);
                if (users == null) {
                    throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                            "[" + i + "]:" + I18nUtil.get("organization.add.invalid.employee"));
                }
                this.batchHandleUsersOrganization(orgId, userTypeList, positionId, Collections.singletonList(objectId));
            }
            else {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                        "[" + i + "]:" + I18nUtil.get("organization.add.invalid.object.type"));
            }
        }
        return ResponseUtil.success(I18nUtil.get("organization.add.member.success"));
    }

    /**
     * 获取用户类型列表并验证
     * @param usersDTO 入参
     * @return  List<String> 用户类型列表
     */
    public List<String> getUserTypeListAndValidate(AddUserByOrgDTO usersDTO) {
        // 1. 多选不为空 → 直接返回 userTypes
        if (CollUtil.isNotEmpty(usersDTO.getUserTypes())) {
            return usersDTO.getUserTypes();
        }
        // 2. 单选不为空 → 转成单元素列表
        else if (StrUtil.isNotBlank(usersDTO.getUserType())) {
            return Collections.singletonList(usersDTO.getUserType());
        }
        else {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("adduserbyorgdto.role.notempty"));
        }
    }

    /**
     * 批量处理用户添加到组织下面
     *
     * @param orgId 组织标识
     * @param userTypeList 角色类型
     * @param positionId 岗位标识
     * @param userIds 用户列表
     */
    private void batchHandleUsersOrganization(Long orgId, List<String> userTypeList, Long positionId, List<Long> userIds) {
        for (Long userId : userIds) {

            // 非平台管理员
            if (!(CurrentUserHolder.isPlatformManager() || organizationService.isOrganizationManManager(orgId))) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                        I18nUtil.get("organization.permission.nopermission"));
            }

            // 平台管理角色权限判断
            if (userTypeList.stream().anyMatch(UserType.PLAT_MAN::equalsIgnoreCase)  && !CurrentUserHolder.isPlatformManager()) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                        I18nUtil.get("organization.platformadmin.add.nopermission"));
            }

            usersOrganizationService.addUsersOrganization(userId, orgId, userTypeList, positionId);
        }
    }

    /***
     * 新增组织
     *
     * @param organization 新增组织
     */
    public ResponseUtil addOrg(Organization organization) {

        if (!(CurrentUserHolder.isPlatformManager()
                || organizationService.isOrganizationManManager(organization.getParentOrgId()))) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                    I18nUtil.get("organization.add.nopermission"));
        }

        // 保存组织
        organizationService.addOrg(organization);

        // 发布组织新增事件
        eventPublisher.publishEvent(new OrganizationCreatedEvent(this, organization));

        // 写入缓存
        ShareCacheUtil.setShareOrganization(organization);

        return ResponseUtil.successResponse(organization.getOrgId());
    }

    /**
     * 更新组织
     *
     * @param organization 组织信息
     */
    public void updateOrg(Organization organization) {

        if (!(CurrentUserHolder.isPlatformManager()
                || organizationService.isOrganizationManManager(organization.getOrgId()))) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                    I18nUtil.get("organization.update.nopermission"));
        }

        Organization updateOrganization = organizationService.updateOrg(organization);

        // 更新缓存
        ShareCacheUtil.setShareOrganization(updateOrganization);

        // 发布组织更新事件
        eventPublisher.publishEvent(new OrganizationUpdatedEvent(this, updateOrganization));

    }

    /**
     * 删除组织l
     *
     * @param orgId 组织标识
     */
    public void delOrg(Long orgId) {

        // 权限检查
        if (!(CurrentUserHolder.isPlatformManager() || organizationService.isOrganizationManManager(orgId))) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                    I18nUtil.get("organization.delete.nopermission"));
        }

        // 删除组织前清理外部系统映射数据
        organizationService.clearOrganizationExternalSystemData(orgId);

        // 删除组织
        organizationService.delOrg(orgId);

        // 发布组织删除事件
        eventPublisher.publishEvent(new OrganizationDeletedEvent(this, orgId));
    }

    /**
     * 查询组织树,包含子组织数量
     *
     * @param orgTreeQo 入参
     * @return 组织树视图对象列表
     */
    public List<OrgTreeVo> getOpenOrgTree(OrgTreeQo orgTreeQo) {
        return organizationMapper.getOpenOrgTree(orgTreeQo);
    }


}
