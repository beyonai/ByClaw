package com.iwhalecloud.byai.manager.mapper.permissiongroup;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.iwhalecloud.byai.manager.entity.permissiongroup.PermissionGroup;
import com.iwhalecloud.byai.manager.qo.permissiongroup.PermissionGroupQueryQO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.PermissionGroupVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.PermissionGroupWithCatalogVO;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 权限组Mapper接口
 */
public interface PermissionGroupMapper extends BaseMapper<PermissionGroup> {

    /**
     * 分页查询权限组列表
     *
     * @param page 分页对象
     * @param queryQO 查询条件
     * @return 权限组列表
     */
    IPage<PermissionGroupVO> selectPermissionGroupPage(IPage<PermissionGroupVO> page,
                                                        @Param("query") PermissionGroupQueryQO queryQO);

    /**
     * 查询权限组详情
     *
     * @param id 权限组ID
     * @return 权限组详情
     */
    PermissionGroupVO selectPermissionGroupDetail(@Param("id") Long id);

    /**
     * 根据编码查询权限组数量（用于判断编码是否重复）
     *
     * @param groupCode 权限组编码
     * @param excludeId 排除的ID（修改时使用）
     * @return 数量
     */
    Long countByGroupCode(@Param("groupCode") String groupCode, @Param("excludeId") Long excludeId);

    /**
     * 根据名称查询权限组数量（用于判断名称是否重复）
     *
     * @param groupName 权限组名称
     * @param excludeId 排除的ID（修改时使用）
     * @return 数量
     */
    Long countByGroupName(@Param("groupName") String groupName, @Param("excludeId") Long excludeId);

    /**
     * 查询权限组列表（不分页）
     *
     * @param queryQO 查询条件
     * @return 权限组列表
     */
    List<PermissionGroupVO> selectPermissionGroupList(@Param("query") PermissionGroupQueryQO queryQO);

    /**
     * 根据权限组名称模糊查询权限组列表（含目录信息，用于权限组和目录联合查询）
     *
     * @param groupName 权限组名称（模糊匹配）
     * @param userId 用户ID（可选）
     * @return 权限组（含目录信息）列表
     */
    List<PermissionGroupWithCatalogVO> selectPermissionGroupWithCatalogByGroupName(
            @Param("groupName") String groupName, @Param("userId") Long userId);

}

