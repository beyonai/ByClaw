package com.iwhalecloud.byai.manager.application.service.user.base;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.event.user.UsersCreatedEvent;
import com.iwhalecloud.byai.manager.domain.event.user.UsersUpdatedEvent;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.position.service.PositionService;
import com.iwhalecloud.byai.manager.domain.role.service.RoleService;
import com.iwhalecloud.byai.manager.domain.superassist.domain.AssistPrologue;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.domain.superassist.service.SsSuperassistKwCatalogService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import com.iwhalecloud.byai.manager.vo.users.UsersOrganizationVo;
import com.iwhalecloud.byai.manager.infrastructure.cache.ShareCacheUtil;
import com.iwhalecloud.byai.common.ecrypt.RsaDecrypt;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import java.util.ArrayList;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-05-31 22:51:06
 * @description TODO
 */
@Service
public class BaseUserApplicationService {

    @Autowired
    protected RoleService roleService;

    @Autowired
    protected PositionService positionService;

    @Autowired
    protected OrganizationService organizationService;

    @Autowired
    protected ApplicationEventPublisher eventPublisher;

    @Autowired
    protected EnterpriseInfoService enterpriseInfoService;

    @Autowired
    protected SystemConfigService systemConfigService;

    @Autowired
    protected SuasSuperassistService suasSuperassistService;

    @Autowired
    protected SsSuperassistKwCatalogService ssSuperassistKwCatalogService;

    /**
     * 获取默认配置的初始化密码
     *
     * @return String 返回初始密码
     */
    protected String getDefaultPwd() {
        // 默认配置的密码RSA解密
        String userDefaultPwd = systemConfigService.getStringParamValueByCode("USER_DEFAULT_PWD");
        return RsaDecrypt.decrypt(userDefaultPwd);
    }

    /**
     * 保存用户后的操作
     *
     * @param users 用户
     * @param usersOrganizations 用户关联组织信息
     */
    protected void saveUserAfter(Users users, List<UsersOrganization> usersOrganizations) {

        // 1.更新缓存
        ShareCacheUtil.setShareShareBfmUser(users, enterpriseInfoService.getEnterpriseId());
        ShareCacheUtil.setUsersOrganizationVos(users.getUserId(), this.completeUsersOrganizations(usersOrganizations));

        // 2.调用智能体初始化超级助手
        this.initSuasSuperassist(users);

        // 3.发布用户创建事件
        eventPublisher.publishEvent(new UsersCreatedEvent(this, users, usersOrganizations));
    }

    /**
     * 保存用户后的操作
     *
     * @param users 用户
     * @param usersOrganizations 用户关联组织信息
     */
    protected void updateUserAfter(Users users, List<UsersOrganization> usersOrganizations) {

        // 1.更新缓存
        ShareCacheUtil.setShareShareBfmUser(users, enterpriseInfoService.getEnterpriseId());
        ShareCacheUtil.setUsersOrganizationVos(users.getUserId(), this.completeUsersOrganizations(usersOrganizations));

        // 2.发布用户更新
        eventPublisher.publishEvent(new UsersUpdatedEvent(this, users, usersOrganizations));
    }

    /**
     * 补全用户组织信息写入缓存
     *
     * @param usersOrganizations 用户组织信息
     * @return List<UsersOrganizationVo>
     */
    private List<UsersOrganizationVo> completeUsersOrganizations(List<UsersOrganization> usersOrganizations) {
        List<UsersOrganizationVo> usersOrganizationVos = new ArrayList<>(3);

        for (int i = 0; usersOrganizations != null && i < usersOrganizations.size(); i++) {

            UsersOrganization usersOrganization = usersOrganizations.get(i);
            UsersOrganizationVo usersOrganizationVo = new UsersOrganizationVo();
            BeanUtils.copyProperties(usersOrganization, usersOrganizationVo);
            usersOrganizationVo.setRoleName(roleService.getCacheRoleName(usersOrganization.getUserType()));
            usersOrganizationVo.setOrgName(organizationService.getCacheOrgName(usersOrganization.getOrgId()));
            usersOrganizationVo
                .setPositionName(positionService.getCachePositionName(usersOrganization.getPositionId()));
        }

        return usersOrganizationVos;
    }

    /**
     * 初始化超级助手和对话相目录相�?
     *
     * @param users 用户信息
     */
    protected void initSuasSuperassist(Users users) {
        // 新增默认超级助手；默认个人知识库和默认个人助理仅在用户本人登录时按需初始化。
        SuasSuperassist suasSuperassist = new SuasSuperassist();
        suasSuperassist.setSuperassistId(users.getUserId());
        suasSuperassist.setName(users.getUserName());
        suasSuperassist.setIntro("超级助手");
        suasSuperassist.setStatus("00");
        suasSuperassist.setPrologue(initPrologue(users));
        suasSuperassistService.addSuasSuperassist(suasSuperassist);
    }

    private String initPrologue(Users users) {
        AssistPrologue prologue = new AssistPrologue();
        prologue.setExtAvatar("default");
        prologue.setNickName(users.getUserName());
        prologue.setExtIntro("数字分身");
        return JSON.toJSONString(prologue);
    }
}
