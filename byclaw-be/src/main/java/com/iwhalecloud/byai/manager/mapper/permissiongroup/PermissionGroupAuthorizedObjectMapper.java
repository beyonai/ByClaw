package com.iwhalecloud.byai.manager.mapper.permissiongroup;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.iwhalecloud.byai.manager.entity.permissiongroup.PermissionGroupAuthorizedObject;
import com.iwhalecloud.byai.manager.qo.permissiongroup.AuthorizedObjectQueryQO;
import com.iwhalecloud.byai.manager.qo.permissiongroup.AuthorizedUserQueryQO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.AuthorizedObjectVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.AuthorizedUserVO;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 权限组授权对象关联Mapper接口
 */
public interface PermissionGroupAuthorizedObjectMapper extends BaseMapper<PermissionGroupAuthorizedObject> {

    /**
     * 分页查询授权对象列表
     *
     * @param page 分页对象
     * @param queryQO 查询条件
     * @return 授权对象列表
     */
    IPage<AuthorizedObjectVO> selectAuthorizedObjectPage(IPage<AuthorizedObjectVO> page,
                                                          @Param("query") AuthorizedObjectQueryQO queryQO);

    /**
     * 根据权限组ID查询授权对象列表（不分页）
     *
     * @param permissionGroupId 权限组ID
     * @return 授权对象列表
     */
    List<AuthorizedObjectVO> selectByPermissionGroupId(@Param("permissionGroupId") Long permissionGroupId);

    /**
     * 根据权限组ID删除授权对象关联
     *
     * @param permissionGroupId 权限组ID
     * @return 删除数量
     */
    int deleteByPermissionGroupId(@Param("permissionGroupId") Long permissionGroupId);

    /**
     * 批量插入授权对象关联
     *
     * @param list 授权对象关联列表
     * @return 插入数量
     */
    int batchInsert(@Param("list") List<PermissionGroupAuthorizedObject> list);

    /**
     * 查询授权对象数量
     *
     * @param permissionGroupId 权限组ID
     * @return 授权对象数量
     */
    Long countByPermissionGroupId(@Param("permissionGroupId") Long permissionGroupId);

    /**
     * 检查授权对象是否已存在
     *
     * @param permissionGroupId 权限组ID
     * @param objectType 对象类型
     * @param authorizedObjectId 授权对象ID
     * @return 数量
     */
    Long countByObject(@Param("permissionGroupId") Long permissionGroupId,
                       @Param("objectType") String objectType,
                       @Param("authorizedObjectId") Long authorizedObjectId);

    /**
     * 批量删除授权对象关联
     *
     * @param ids 关联ID列表
     * @return 删除数量
     */
    int batchDeleteByIds(@Param("ids") List<Long> ids);

    /**
     * 分页查询权限组授权用户列表（去重）
     *
     * @param page 分页对象
     * @param queryQO 查询条件
     * @return 授权用户列表
     */
    IPage<AuthorizedUserVO> selectAuthorizedUserPage(IPage<AuthorizedUserVO> page,
                                                     @Param("query") AuthorizedUserQueryQO queryQO);

    /**
     * 检查授权对象是否属于权限组
     *
     * @param permissionGroupId 权限组ID
     * @param authorizedObjectId 授权对象ID
     * @return 数量
     */
    Long countByPermissionGroupIdAndAuthorizedObjectId(@Param("permissionGroupId") Long permissionGroupId,
                                                       @Param("authorizedObjectId") Long authorizedObjectId);

    /**
     * 根据权限组ID和对象类型查询授权对象列表
     *
     * @param permissionGroupId 权限组ID
     * @param objectType 对象类型
     * @return 授权对象列表
     */
    List<PermissionGroupAuthorizedObject> selectByPermissionGroupIdAndObjectType(@Param("permissionGroupId") Long permissionGroupId,
                                                                                  @Param("objectType") String objectType);

    /**
     * 分页查询多个权限组授权用户列表（支持permissionGroupId IN查询，去重，过滤排除用户）
     *
     * @param page 分页对象
     * @param queryQO 查询条件（需包含permissionGroupIds列表）
     * @return 授权用户列表
     */
    IPage<AuthorizedUserVO> selectAuthorizedUserPageByPermissionGroupIds(IPage<AuthorizedUserVO> page,
                                                                          @Param("query") AuthorizedUserQueryQO queryQO);

    /**
     * 分页查询多个权限组授权用户列表（支持permissionGroupId IN查询，去重，过滤排除用户）
     *
     * @param queryQO 查询条件（需包含permissionGroupIds列表）
     * @return 授权用户列表
     */
    List<AuthorizedUserVO> selectAuthorizedUserUserScope(@Param("query") AuthorizedUserQueryQO queryQO);

}

