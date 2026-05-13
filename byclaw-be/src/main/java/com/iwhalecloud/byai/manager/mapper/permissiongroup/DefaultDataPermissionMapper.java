package com.iwhalecloud.byai.manager.mapper.permissiongroup;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.permissiongroup.DefaultDataPermission;
import com.iwhalecloud.byai.manager.vo.permissiongroup.DataPermissionVO;
import org.apache.ibatis.annotations.Param;

/**
 * 默认数据权限Mapper接口
 */
public interface DefaultDataPermissionMapper extends BaseMapper<DefaultDataPermission> {

    /**
     * 根据权限组ID查询数据权限
     *
     * @param permissionGroupId 权限组ID
     * @return 数据权限
     */
    DataPermissionVO selectByPermissionGroupId(@Param("permissionGroupId") Long permissionGroupId);

    /**
     * 根据权限组ID删除数据权限
     *
     * @param permissionGroupId 权限组ID
     * @return 删除数量
     */
    int deleteByPermissionGroupId(@Param("permissionGroupId") Long permissionGroupId);

}

