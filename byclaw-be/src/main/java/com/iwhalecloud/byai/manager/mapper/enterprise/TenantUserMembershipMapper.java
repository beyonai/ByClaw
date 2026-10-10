package com.iwhalecloud.byai.manager.mapper.enterprise;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.enterprise.TenantUserMembership;
import com.iwhalecloud.byai.manager.vo.enterprise.UserEnterpriseVo;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 用户与企业租户成员关系 Mapper。
 */
public interface TenantUserMembershipMapper extends BaseMapper<TenantUserMembership> {

    /**
     * 按用户标识联表查询关联企业简要信息。
     *
     * @param userId 用户标识
     * @return 企业简要信息列表
     */
    List<UserEnterpriseVo> listUserEnterprises(@Param("userId") Long userId);
}
