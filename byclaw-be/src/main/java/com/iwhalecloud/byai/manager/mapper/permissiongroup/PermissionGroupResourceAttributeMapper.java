package com.iwhalecloud.byai.manager.mapper.permissiongroup;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.permissiongroup.PermissionGroupResourceAttribute;
import com.iwhalecloud.byai.manager.vo.permissiongroup.ResourceAttributePermissionVO;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 资源属性权限Mapper接口
 */
public interface PermissionGroupResourceAttributeMapper extends BaseMapper<PermissionGroupResourceAttribute> {

    /**
     * 根据资源ID查询资源属性权限列表
     *
     * @param resourceId 资源ID
     * @return 资源属性权限列表
     */
    List<ResourceAttributePermissionVO> selectByResourceId(@Param("resourceId") Long resourceId);

    /**
     * 根据资源ID删除资源属性权限
     *
     * @param resourceId 资源ID
     * @return 删除数量
     */
    int deleteByResourceId(@Param("resourceId") Long resourceId);

    /**
     * 批量插入资源属性权限
     *
     * @param list 资源属性权限列表
     * @return 插入数量
     */
    int batchInsert(@Param("list") List<PermissionGroupResourceAttribute> list);

}

