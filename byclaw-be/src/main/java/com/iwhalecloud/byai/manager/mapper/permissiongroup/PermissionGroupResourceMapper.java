package com.iwhalecloud.byai.manager.mapper.permissiongroup;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.permissiongroup.PermissionGroupResource;
import com.iwhalecloud.byai.manager.qo.permissiongroup.ResourcePermissionQueryQO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.PermissionResourceVO;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 权限组资源关联Mapper接口
 */
public interface PermissionGroupResourceMapper extends BaseMapper<PermissionGroupResource> {

    /**
     * 根据权限组ID查询资源权限列表
     *
     * @param permissionGroupId 权限组ID
     * @return 资源权限列表
     */
    List<PermissionResourceVO> selectByPermissionGroupId(@Param("permissionGroupId") Long permissionGroupId);

    /**
     * 分页查询权限组授权资源列表
     *
     * @param page 分页对象
     * @param queryQO 查询条件
     * @return 授权资源分页列表
     */
    Page<PermissionResourceVO> selectResourcePermissionPage(Page<PermissionResourceVO> page,
            @Param("queryQO") ResourcePermissionQueryQO queryQO);

    /**
     * 根据权限组ID删除资源权限
     *
     * @param permissionGroupId 权限组ID
     * @return 删除数量
     */
    int deleteByPermissionGroupId(@Param("permissionGroupId") Long permissionGroupId);

    /**
     * 根据权限组ID和资源ID删除资源权限
     *
     * @param permissionGroupId 权限组ID
     * @param resourceId 资源ID
     * @return 删除数量
     */
    int deleteByPermissionGroupIdAndResourceId(
            @Param("permissionGroupId") Long permissionGroupId,
            @Param("resourceId") Long resourceId);

    /**
     * 批量插入资源权限
     *
     * @param list 资源权限列表
     * @return 插入数量
     */
    int batchInsert(@Param("list") List<PermissionGroupResource> list);

    /**
     * 批量删除资源权限（根据ID列表）
     *
     * @param ids ID列表
     * @return 删除数量
     */
    int batchDeleteByIds(@Param("ids") List<Long> ids);

    /**
     * 根据权限组ID和资源ID列表批量删除资源权限
     *
     * @param permissionGroupId 权限组ID
     * @param resourceIds 资源ID列表
     * @return 删除数量
     */
    int batchDeleteByPermissionGroupIdAndResourceIds(
            @Param("permissionGroupId") Long permissionGroupId,
            @Param("resourceIds") List<Long> resourceIds);

    /**
     * 根据资源ID查询关联的权限组列表
     *
     * @param resourceId 资源ID
     * @return 权限组列表
     */
    List<PermissionResourceVO> selectPermissionGroupsByResourceId(@Param("resourceId") Long resourceId);

    /**
     * 根据资源ID删除所有关联的权限组
     *
     * @param resourceId 资源ID
     * @return 删除数量
     */
    int deleteByResourceId(@Param("resourceId") Long resourceId);

}

