package com.iwhalecloud.byai.manager.mapper.permissiongroup;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.iwhalecloud.byai.manager.qo.permissiongroup.AvailableObjectQueryQO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.AvailableObjectVO;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 可用授权对象Mapper接口
 * 用于查询可以添加到权限组的用户/组织列表
 */
public interface AvailableObjectMapper {

    /**
     * 分页查询可用用户列表
     *
     * @param page 分页对象
     * @param queryQO 查询条件
     * @return 用户列表
     */
    IPage<AvailableObjectVO> selectAvailableUsers(IPage<AvailableObjectVO> page,
                                                   @Param("query") AvailableObjectQueryQO queryQO);

    /**
     * 分页查询可用组织列表
     *
     * @param page 分页对象
     * @param queryQO 查询条件
     * @return 组织列表
     */
    IPage<AvailableObjectVO> selectAvailableOrganizations(IPage<AvailableObjectVO> page,
                                                           @Param("query") AvailableObjectQueryQO queryQO);

    /**
     * 查询可用用户列表（不分页）
     *
     * @param queryQO 查询条件
     * @return 用户列表
     */
    List<AvailableObjectVO> selectAvailableUserList(@Param("query") AvailableObjectQueryQO queryQO);

    /**
     * 查询可用组织列表（不分页）
     *
     * @param queryQO 查询条件
     * @return 组织列表
     */
    List<AvailableObjectVO> selectAvailableOrganizationList(@Param("query") AvailableObjectQueryQO queryQO);

}

