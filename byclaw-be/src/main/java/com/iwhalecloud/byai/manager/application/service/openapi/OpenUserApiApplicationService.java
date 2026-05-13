package com.iwhalecloud.byai.manager.application.service.openapi;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.user.base.BaseUserApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketProvisioningService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrgExternalSystemService;
import com.iwhalecloud.byai.manager.domain.position.service.PositionExternalService;
import com.iwhalecloud.byai.manager.entity.users.UserExternalSystem;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganizationExternalSystem;
import com.iwhalecloud.byai.manager.domain.users.service.UserExternalSystemService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.domain.users.service.UsersOrganizationExternalSystemService;
import com.iwhalecloud.byai.manager.domain.users.service.UsersOrganizationService;
import com.iwhalecloud.byai.manager.dto.openapi.OpenDelUserDTO;
import com.iwhalecloud.byai.manager.dto.openapi.OpenUserDTO;
import com.iwhalecloud.byai.manager.dto.openapi.OpenUserOrgDTO;
import com.iwhalecloud.byai.common.constants.users.IsLocked;
import com.iwhalecloud.byai.common.constants.users.SourceType;
import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.common.ecrypt.MD5Utils;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;

/**
 * @author he.duming
 * @date 2025-05-31 22:57:34
 * @description TODO
 */
@Service
public class OpenUserApiApplicationService extends BaseUserApplicationService {

    @Autowired
    private UserService userService;

    @Autowired
    private OrgExternalSystemService orgExternalSystemService;

    @Autowired
    private UserExternalSystemService userExternalSystemService;

    @Autowired
    private UsersOrganizationService usersOrganizationService;

    @Autowired
    private PositionExternalService positionExternalService;

    @Autowired
    private UsersOrganizationExternalSystemService usersOrganizationExternalSystemService;

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private UserBucketProvisioningService userBucketProvisioningService;

    /**
     * 新增员工
     *
     * @param openUserDTO 新增
     * @return 新建用户主键
     */
    public Long addUser(OpenUserDTO openUserDTO) {

        // 保存用户
        Users users = new Users();
        BeanUtils.copyProperties(openUserDTO, users);
        if (openUserDTO.isNewPrimaryKey()) {
            users.setUserId(SequenceService.nextVal());
        }
        else {
            users.setUserId(openUserDTO.getUserId());
        }
        // 手机号加密
        String inputPhone = openUserDTO.getPhone();
        if (StringUtils.isNotBlank(inputPhone)) {
            users.setPhone(Sm4Util.encrypt(inputPhone));
        }

        // 如果密码为空使用默认的
        if (StringUtils.isEmpty(users.getPwd())) {
            users.setPwd(MD5Utils.encrypt(this.getDefaultPwd(), users.getUserCode()));
        }

        users.setIsLocked(IsLocked.NO);
        users.setAssistantId(users.getUserId());
        users.setUserEffDate(new Date());
        userService.save(users);

        // 用户扩展信息
        UserExternalSystem userExternalSystem = new UserExternalSystem();
        userExternalSystem.setId(SequenceService.nextVal());
        userExternalSystem.setUserId(users.getUserId());
        userExternalSystem.setSourceNickname(openUserDTO.getUserName());
        userExternalSystem.setSourceEmail(openUserDTO.getEmail());
        userExternalSystem.setSourceType(SourceType.LOCAL);
        userExternalSystem.setUnionId(String.valueOf(openUserDTO.getUserId()));
        userExternalSystem.setBindingTime(new Date());
        userExternalSystemService.save(userExternalSystem);

        // 处理用户组织关联关系
        List<UsersOrganization> usersOrganizations = this.handleUserOrgs(users, openUserDTO);

        // 保存用户信息后的操作
        this.saveUserAfter(users, usersOrganizations);

        // 开放接口新增用户成功后，初始化默认 MinIO 桶，失败只记日志，不影响新增用户主流程。
        userBucketProvisioningService.ensureUserBucketQuietly(users.getUserCode());

        return users.getUserId();
    }

    /**
     * @param users 当前系统用户信息
     * @param openUserDTO 开放系统用户信息
     * @return List
     */
    private List<UsersOrganization> handleUserOrgs(Users users, OpenUserDTO openUserDTO) {

        // 获取用户组织关系
        List<UsersOrganization> usersOrganizations = new ArrayList<>(10);
        for (OpenUserOrgDTO userOrg : openUserDTO.getUserOrgs()) {

            // 创建用户关联组织岗位信息
            UsersOrganization usersOrganization = new UsersOrganization();
            usersOrganization.setId(SequenceService.nextVal());
            usersOrganization.setUserId(users.getUserId());
            usersOrganization.setUserType(userOrg.getUserType());
            usersOrganization.setOrgId(orgExternalSystemService.findOrgIdByUnionId(userOrg.getOrgId() + ""));
            usersOrganization
                .setPositionId(positionExternalService.findPositionIdByUnionId(userOrg.getPositionId() + ""));
            usersOrganizations.add(usersOrganization);
            usersOrganizationService.save(usersOrganization);

            UsersOrganizationExternalSystem usersOrganizationExternal = new UsersOrganizationExternalSystem();
            usersOrganizationExternal.setPoUsersOrganizationExternalId(SequenceService.nextVal());
            usersOrganizationExternal.setSourceType(SourceType.LOCAL);
            usersOrganizationExternal.setPoOrgExternalSystemId(userOrg.getOrgId());
            usersOrganizationExternal.setPoUserExternalSystemId(users.getUserId());
            usersOrganizationExternal.setUsersOrganizationId(usersOrganization.getId());
            usersOrganizationExternalSystemService.save(usersOrganizationExternal);
        }

        return usersOrganizations;
    }

    /**
     * 更新用户
     *
     * @param openUserDTO 更新用户信息
     * @return 用户主键
     */
    public Long updateUser(OpenUserDTO openUserDTO) {

        Long userId = openUserDTO.getUserId();
        UserExternalSystem userExternalSystem = userExternalSystemService.findByUnionId(SourceType.LOCAL, userId + "");
        userExternalSystem.setSourceAccount(openUserDTO.getUserCode());
        userExternalSystem.setSourceNickname(openUserDTO.getUserName());
        userExternalSystem.setSourceEmail(openUserDTO.getEmail());

        // 修改外系统信息
        Users users = userService.findById(userExternalSystem.getUserId());
        users.setUserCode(openUserDTO.getUserCode());
        users.setUserName(openUserDTO.getUserName());
        users.setEmail(openUserDTO.getEmail());
        // 手机号加密
        String inputPhone = openUserDTO.getPhone();
        if (StringUtils.isNotBlank(inputPhone)) {
            users.setPhone(Sm4Util.encrypt(inputPhone));
        }
        users.setUserNumber(openUserDTO.getUserNumber());

        // 如果密码为空使用默认的
        if (StringUtils.isNotEmpty(openUserDTO.getPwd())) {
            users.setPwd(openUserDTO.getPwd());
        }

        if (null != openUserDTO.getStationId()) {
            users.setStationId(openUserDTO.getStationId());
        }
        userService.update(users);

        // 1.先删除用户组织关系
        this.clearUserOrgs(users.getUserId());

        // 2.后新增用户组织关系
        List<UsersOrganization> usersOrganizations = this.handleUserOrgs(users, openUserDTO);

        // 3.更新后操作
        super.updateUserAfter(users, usersOrganizations);

        return users.getUserId();
    }

    /**
     * 清除用户组织关系
     */
    private void clearUserOrgs(Long userId) {
        List<UsersOrganization> usersOrganizations = usersOrganizationService.findByUserId(userId);
        for (UsersOrganization usersOrganization : usersOrganizations) {
            usersOrganizationService.removeByPrimaryKey(usersOrganization.getId());
            // 删除外系统扩展
            usersOrganizationExternalSystemService.deleteByUsersOrganizationId(usersOrganization.getId());
        }
    }

    /**
     * 删除用户信息
     *
     * @param openDelUserDTO 删除用户信息
     */
    public void deleteUser(OpenDelUserDTO openDelUserDTO) {

        Long userId = openDelUserDTO.getUserId();
        UserExternalSystem userExternalSystem = userExternalSystemService.findByUnionId(SourceType.LOCAL, userId + "");

        userExternalSystemService.deleteById(userExternalSystem.getId());

        // 查询本系统的用户信息
        Users users = userService.findById(userExternalSystem.getUserId());
        users.setState(UserState.DISABLED);
        userService.update(users);

        // 删除用户关联组织关系
        this.clearUserOrgs(users.getUserId());
    }

}
