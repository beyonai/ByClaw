package com.iwhalecloud.byai.manager.mapper.users;

import java.util.List;
import java.util.Set;

import org.apache.ibatis.annotations.Param;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import com.iwhalecloud.byai.manager.vo.users.UsersOrgPostVo;

public interface UsersOrganizationMapper extends BaseMapper<UsersOrganization> {

    /***
     * 查询用户是否有绑定其他组织
     *
     * @param userId 用户标识
     * @param orgId 组织标识
     * @return 记录数
     */
    Long countExcludeCurrent(@Param("userId") Long userId, @Param("orgId") Long orgId);

    /**
     * 分页查询用户关联组织信息
     */
    List<UsersOrgPostVo> selectUsersOrganizationVoList();

    List<Long> selectUsersInBatch(@Param("orgIds")Set<Long> orgIds, @Param("positionIds")Set<Long> positionIds, @Param("stationIds")Set<Long> stationIds);

    /**
     * 批量保存用户关联关系
     * @param usersOrganizations 用户组织关系列表
     */
    void saveBatch(@Param("usersOrganizations")List<UsersOrganization> usersOrganizations);
}
