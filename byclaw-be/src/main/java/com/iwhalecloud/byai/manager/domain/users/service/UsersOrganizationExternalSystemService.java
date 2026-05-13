package com.iwhalecloud.byai.manager.domain.users.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganizationExternalSystem;
import com.iwhalecloud.byai.manager.mapper.users.UsersOrganizationExternalSystemMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * @author he.duming
 * @date 2025-05-30 00:55:58
 * @description TODO
 */

@Service
public class UsersOrganizationExternalSystemService {

    @Autowired
    private UsersOrganizationExternalSystemMapper usersOrganizationExternalSystemMapper;

    /**
     * 保存外部表关联
     *
     * @param usersOrganizationExternal 用户关联组织外部表
     */
    public void save(UsersOrganizationExternalSystem usersOrganizationExternal) {
        usersOrganizationExternalSystemMapper.insert(usersOrganizationExternal);
    }

    /**
     * 保存外部表关联
     *
     * @param poUsersOrganizationExternalId 用户关联组织外部表
     */
    public void deleteById(Long poUsersOrganizationExternalId) {
        usersOrganizationExternalSystemMapper.deleteById(poUsersOrganizationExternalId);
    }

    /**
     * 保存外部表关联
     *
     * @param usersOrganizationId 用户关联组织外部表
     */
    public void deleteByUsersOrganizationId(Long usersOrganizationId) {
        LambdaQueryWrapper<UsersOrganizationExternalSystem> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(UsersOrganizationExternalSystem::getUsersOrganizationId, usersOrganizationId);
        usersOrganizationExternalSystemMapper.delete(queryWrapper);
    }

}
