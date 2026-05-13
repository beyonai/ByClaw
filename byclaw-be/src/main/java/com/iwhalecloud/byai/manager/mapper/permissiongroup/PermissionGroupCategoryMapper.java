package com.iwhalecloud.byai.manager.mapper.permissiongroup;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.iwhalecloud.byai.manager.entity.permissiongroup.PermissionGroupCategory;
import com.iwhalecloud.byai.manager.qo.permissiongroup.PermissionGroupCategoryQueryQO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.CatalogSimpleVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.PermissionGroupCategoryVO;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 权限组目录Mapper接口
 */
public interface PermissionGroupCategoryMapper extends BaseMapper<PermissionGroupCategory> {

    /**
     * 分页查询目录列表
     *
     * @param page 分页对象
     * @param queryQO 查询条件
     * @return 目录列表
     */
    IPage<PermissionGroupCategoryVO> selectCategoryPage(IPage<PermissionGroupCategoryVO> page,
                                                         @Param("query") PermissionGroupCategoryQueryQO queryQO);

    /**
     * 查询目录列表（不分页）
     *
     * @param queryQO 查询条件
     * @return 目录列表
     */
    List<PermissionGroupCategoryVO> selectCategoryList(@Param("query") PermissionGroupCategoryQueryQO queryQO);

    /**
     * 查询目录详情
     *
     * @param id 目录ID
     * @return 目录详情
     */
    PermissionGroupCategoryVO selectCategoryDetail(@Param("id") Long id);

    /**
     * 根据编码查询目录数量（校验唯一性）
     *
     * @param categoryCode 目录编码
     * @param excludeId 排除的ID
     * @return 数量
     */
    Long countByCategoryCode(@Param("categoryCode") String categoryCode,
                              @Param("excludeId") Long excludeId);

    /**
     * 根据名称查询目录数量（校验唯一性）
     *
     * @param categoryName 目录名称
     * @param parentId 父级ID
     * @param excludeId 排除的ID
     * @return 数量
     */
    Long countByCategoryName(@Param("categoryName") String categoryName,
                              @Param("parentId") Long parentId,
                              @Param("excludeId") Long excludeId);

    /**
     * 查询子目录数量
     *
     * @param parentId 父级目录ID
     * @return 子目录数量
     */
    Long countByParentId(@Param("parentId") Long parentId);

    /**
     * 查询目录下的权限组数量
     *
     * @param categoryId 目录ID
     * @return 权限组数量
     */
    Long countPermissionGroupByCategoryId(@Param("categoryId") Long categoryId);

    /**
     * 查询所有子目录ID（递归）
     *
     * @param parentId 父级目录ID
     * @return 子目录ID列表
     */
    List<Long> selectChildrenIds(@Param("parentId") Long parentId);

    /**
     * 根据目录名称模糊查询目录列表（用于权限组和目录联合查询）
     *
     * @param catalogName 目录名称（模糊匹配）
     * @param userId 用户ID（可选）
     * @return 目录简化信息列表
     */
    List<CatalogSimpleVO> selectCatalogByCatalogName(
            @Param("catalogName") String catalogName, @Param("userId") Long userId);

}

