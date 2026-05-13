package com.iwhalecloud.byai.manager.mapper.users;

import com.iwhalecloud.byai.manager.entity.temp.TempQo;
import java.util.List;

import org.apache.ibatis.annotations.Param;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.qo.users.SearchUserQo;
import com.iwhalecloud.byai.manager.vo.users.UsersDetailVo;
import com.iwhalecloud.byai.manager.vo.users.UsersOrgVo;

public interface UsersMapper extends BaseMapper<Users> {

    /**
     * 获取组织下的所有员工
     *
     * @param page 分页信息
     * @param orgId 组织标识
     * @param containsChildren 是否包含子组织成员
     * @param positionId 岗位信息查询
     * @param userType 用户角色类型
     * @param keyword 关键字查询
     * @return List<UsersOrgVo>
     */
    IPage<UsersOrgVo> getUsersByOrgId(@Param("page") Page<UsersOrgVo> page, @Param("orgId") Long orgId,
        @Param("containsChildren") boolean containsChildren, @Param("positionId") Long positionId,
        @Param("userType") String userType, @Param("keyword") String keyword);

    /**
     * 查看用户详情
     *
     * @param searchUserQo 入参
     * @return UsersDetailVo
     */
    UsersDetailVo selectUsersDetailVo(SearchUserQo searchUserQo);

    /**
     * 根据用户编码或者用户工号查询重复数据
     *
     * @param userCode 用户编码
     * @param userNumber 用户工号
     * @param userIdNotEqual 用户标识
     * @return Long
     */
    Long countUsers(@Param("userCode") String userCode, @Param("userNumber") String userNumber,
        @Param("userIdNotEqual") Long userIdNotEqual);

    /**
     * 根据组织查询用户
     *
     * @param orgId 组织标识
     * @return List
     */
    List<Long> findUserIdsByOrgId(@Param("orgId") Long orgId);

    /**
     * 查找用户信息
     *
     * @param unionId 统一标识
     * @return Users
     */
    Users findUserByUnionId(@Param("unionId") String unionId);

    List<Long> findUserIdsByPostId(Long grantToObjId);

    List<Long> findUserIdsByStationId(Long grantToObjId);

    /**
     * 根据组织ID列表查询用户（支持批量组织查询）
     *
     * @param orgIdList 组织ID列表
     * @return List<Long> 用户ID列表
     */
    List<Long> findUserIdsByOrgIdList(@Param("orgIdList") List<Long> orgIdList);

    /**
     * 根据驻地ID列表查询用户（支持批量驻地查询）
     *
     * @param stationIdList 驻地ID列表
     * @return List<Long> 用户ID列表
     */
    List<Long> findUserIdsByStationIdList(@Param("stationIdList") List<Long> stationIdList);

    List<String> queryEmailByOrgAndName(TempQo tempQo);

    List<String> queryNameByOrgAndName(TempQo tempQo);

    /**
     * 批量更新用户信息
     *
     * @param usersList 用户列表
     * @return 更新的记录数
     */
    int batchUpdateUsers(@Param("usersList") List<Users> usersList);

    /**
     * 根据用户编码列表批量查询用户详情
     * 
     * @param list 用户编码列表
     * @return 用户详情列表
     */
    List<UsersDetailVo> selectUsersDetailVoByCode(@Param("list") List<String> list);
}
