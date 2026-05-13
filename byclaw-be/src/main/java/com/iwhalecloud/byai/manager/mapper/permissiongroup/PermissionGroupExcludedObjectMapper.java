package com.iwhalecloud.byai.manager.mapper.permissiongroup;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.iwhalecloud.byai.manager.entity.permissiongroup.PermissionGroupExcludedObject;
import com.iwhalecloud.byai.manager.qo.permissiongroup.AuthorizedObjectQueryQO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.AuthorizedObjectVO;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 权限组排除授权对象关联Mapper接口
 */
public interface PermissionGroupExcludedObjectMapper extends BaseMapper<PermissionGroupExcludedObject> {

    /**
     * 分页查询排除对象列表
     *
     * @param page 分页对象
     * @param queryQO 查询条件
     * @return 排除对象列表
     */
    IPage<AuthorizedObjectVO> selectExcludedObjectPage(IPage<AuthorizedObjectVO> page,
                                                       @Param("query") AuthorizedObjectQueryQO queryQO);

    /**
     * 根据权限组ID查询排除对象列表（不分页）
     *
     * @param permissionGroupId 权限组ID
     * @return 排除对象列表
     */
    List<AuthorizedObjectVO> selectByPermissionGroupId(@Param("permissionGroupId") Long permissionGroupId);

    /**
     * 根据权限组ID删除排除对象关联
     *
     * @param permissionGroupId 权限组ID
     * @return 删除数量
     */
    int deleteByPermissionGroupId(@Param("permissionGroupId") Long permissionGroupId);

    /**
     * 批量插入排除对象关联
     *
     * @param list 排除对象关联列表
     * @return 插入数量
     */
    int batchInsert(@Param("list") List<PermissionGroupExcludedObject> list);

    /**
     * 查询排除对象数量
     *
     * @param permissionGroupId 权限组ID
     * @return 排除对象数量
     */
    Long countByPermissionGroupId(@Param("permissionGroupId") Long permissionGroupId);

    /**
     * 检查排除对象是否已存在
     *
     * @param permissionGroupId 权限组ID
     * @param objectType 对象类型
     * @param excludedObjectId 排除对象ID
     * @return 数量
     */
    Long countByObject(@Param("permissionGroupId") Long permissionGroupId,
                       @Param("objectType") String objectType,
                       @Param("excludedObjectId") Long excludedObjectId);

    /**
     * 批量删除排除对象关联
     *
     * @param ids 关联ID列表
     * @return 删除数量
     */
    int batchDeleteByIds(@Param("ids") List<Long> ids);

    /**
     * 根据权限组ID和对象类型查询排除的用户ID列表
     *
     * @param permissionGroupId 权限组ID
     * @param objectType 对象类型
     * @return 排除的用户ID列表
     */
    List<Long> selectExcludedUserIdsByPermissionGroupId(@Param("permissionGroupId") Long permissionGroupId,
                                                        @Param("objectType") String objectType);

    /**
     * 根据权限组ID和对象类型查询排除的组织ID列表
     *
     * @param permissionGroupId 权限组ID
     * @param objectType 对象类型
     * @return 排除的组织ID列表
     */
    List<Long> selectExcludedOrgIdsByPermissionGroupId(@Param("permissionGroupId") Long permissionGroupId,
                                                       @Param("objectType") String objectType);

    /**
     * 根据权限组ID和对象类型查询排除的岗位ID列表
     *
     * @param permissionGroupId 权限组ID
     * @param objectType 对象类型
     * @return 排除的岗位ID列表
     */
    List<Long> selectExcludedPositionIdsByPermissionGroupId(@Param("permissionGroupId") Long permissionGroupId,
                                                            @Param("objectType") String objectType);

    /**
     * 根据权限组ID和对象类型查询排除对象列表
     *
     * @param permissionGroupId 权限组ID
     * @param objectType 对象类型
     * @return 排除对象列表
     */
    List<PermissionGroupExcludedObject> selectByPermissionGroupIdAndObjectType(@Param("permissionGroupId") Long permissionGroupId,
                                                                                @Param("objectType") String objectType);

}
