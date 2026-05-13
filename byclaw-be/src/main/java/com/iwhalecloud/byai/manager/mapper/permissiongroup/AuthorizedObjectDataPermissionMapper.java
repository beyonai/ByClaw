package com.iwhalecloud.byai.manager.mapper.permissiongroup;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.permissiongroup.AuthorizedObjectDataPermission;
import com.iwhalecloud.byai.manager.vo.permissiongroup.AuthorizedObjectDataPermissionVO;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 授权对象数据权限Mapper接口
 */
public interface AuthorizedObjectDataPermissionMapper extends BaseMapper<AuthorizedObjectDataPermission> {

    /**
     * 根据权限组ID查询授权对象数据权限列表
     *
     * @param permissionGroupId 权限组ID
     * @return 授权对象数据权限列表
     */
    List<AuthorizedObjectDataPermissionVO> selectByPermissionGroupId(@Param("permissionGroupId") Long permissionGroupId);

    /**
     * 根据权限组ID和用户ID查询数据权限
     *
     * @param permissionGroupId 权限组ID
     * @param userId 用户ID
     * @return 数据权限
     */
    AuthorizedObjectDataPermissionVO selectByPermissionGroupIdAndUserId(
            @Param("permissionGroupId") Long permissionGroupId,
            @Param("userId") Long userId);

    /**
     * 根据权限组ID删除所有授权对象数据权限
     *
     * @param permissionGroupId 权限组ID
     * @return 删除数量
     */
    int deleteByPermissionGroupId(@Param("permissionGroupId") Long permissionGroupId);

    /**
     * 根据权限组ID和用户ID删除数据权限
     *
     * @param permissionGroupId 权限组ID
     * @param userId 用户ID
     * @return 删除数量
     */
    int deleteByPermissionGroupIdAndUserId(
            @Param("permissionGroupId") Long permissionGroupId,
            @Param("userId") Long userId);




    /**
     * 批量插入授权对象数据权限
     *
     * @param list 数据权限列表
     * @return 插入数量
     */
    int batchInsert(@Param("list") List<AuthorizedObjectDataPermission> list);

    /**
     * 批量删除指定权限组下的多个用户的数据权限
     *
     * @param permissionGroupId 权限组ID
     * @param userIds 用户ID列表
     * @return 删除数量
     */
    int batchDeleteByPermissionGroupIdAndUserIds(
            @Param("permissionGroupId") Long permissionGroupId,
            @Param("userIds") List<Long> userIds);

}
