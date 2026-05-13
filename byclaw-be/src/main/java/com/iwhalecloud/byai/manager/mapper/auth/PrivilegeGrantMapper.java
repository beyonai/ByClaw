package com.iwhalecloud.byai.manager.mapper.auth;

import com.iwhalecloud.byai.manager.domain.resource.request.ResourceUseAuthQo;
import com.iwhalecloud.byai.manager.dto.auth.ManOrgDTO;
import com.iwhalecloud.byai.manager.dto.auth.PriviledgeQo;
import com.iwhalecloud.byai.manager.dto.openapi.PrivilegeQueryDTO;
import com.iwhalecloud.byai.manager.qo.auth.AuthQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceAuthQo;
import com.iwhalecloud.byai.manager.vo.auth.DigitalEmployeeAuthVo;
import com.iwhalecloud.byai.manager.vo.auth.ManPrivDto;
import com.iwhalecloud.byai.manager.qo.resource.PrivListQo;
import java.util.List;
import com.iwhalecloud.byai.manager.vo.auth.PrivilegeGrantVo;
import java.util.Map;
import com.iwhalecloud.byai.manager.vo.auth.ResourceAuthVo;
import org.apache.ibatis.annotations.Param;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrantWithOrgPath;
import com.iwhalecloud.byai.manager.qo.auth.AuthDetailQo;
import com.iwhalecloud.byai.manager.qo.auth.AuthManQo;
import com.iwhalecloud.byai.manager.qo.auth.DigitalEmployeeAuthQo;
import com.iwhalecloud.byai.manager.qo.auth.OwnAuthQo;
import com.iwhalecloud.byai.manager.qo.auth.PrivilegeGrantQo;
import com.iwhalecloud.byai.manager.vo.auth.ResourceMemberItemVo;
import com.iwhalecloud.byai.manager.vo.auth.AuthVo;
import com.iwhalecloud.byai.manager.vo.auth.PrivilegeGrantAuditVo;
import com.iwhalecloud.byai.manager.dto.resource.PermissionDto;
import com.iwhalecloud.byai.common.login.bean.UserManageOrg;

/**
 * @author he.duming
 * @date 2025-04-24 18:13:58
 * @description TODO
 */
public interface PrivilegeGrantMapper extends BaseMapper<PrivilegeGrant> {

    /**
     * 查询权限对象
     *
     * @param privilegeGrantQo 授权查询对象
     */
    List<PrivilegeGrant> findPrivilegeByQo(PrivilegeGrantQo privilegeGrantQo);

    /**
     * 查询授予权限列表
     *
     * @param privilegeGrantQo 授权查询对象
     */
    List<PrivilegeGrantVo> findPrivilegeGrantByCondition(PrivilegeGrantQo privilegeGrantQo);

    /**
     * 查询数据员工授权信息
     *
     * @param digitalEmployeeAuthQo 数据员工查询对象
     */
    List<AuthVo> listDigitalEmployeeAuth(@Param("digitalEmployeeAuthQo") DigitalEmployeeAuthQo digitalEmployeeAuthQo);

    /**
     * 查询资源授权
     *
     * @param resourceUseAuthQo 资源授权对象
     */
    List<ResourceAuthVo> listResourceAuth(ResourceUseAuthQo resourceUseAuthQo);

    /**
     * 查询红黑名单
     *
     * @param grantType 授权类型
     * @param grantObjType 授权信息
     * @param grantObjId 授权类型
     * @param color 红黑名单
     */
    List<PrivilegeGrant> findPrivilegeGrant(@Param("grantType") String grantType,
        @Param("grantObjType") String grantObjType, @Param("grantObjId") Long grantObjId, @Param("color") String color);

    /**
     * 查询授权管理资源标识
     *
     * @return List
     */
    List<Long> findAllowManagePrivilegeGrant(@Param("userId") Long userId,
        @Param("grantObjTypes") List<String> grantObjTypes);

    List<AuthVo> getAuthList(Page<AuthVo> page, @Param("priviledgeQo") PriviledgeQo priviledgeQo);

    List<ManOrgDTO> listMangerOrgUseDetail(AuthManQo authManQo);

    /**
     * 查询用户管理组织
     *
     * @return List
     */
    List<UserManageOrg> findUserManageOrg(@Param("userId") Long userId);

    /**
     * 授权资源或数据员工授权id
     *
     * @param authQo 查询对象
     */
    List<Long> listOwnResourceOrEmployee(OwnAuthQo authQo);

    List<PrivilegeGrant> queryPriviledgeWithOrgLevel(AuthDetailQo authDetailQo);

    /**
     * 查询审核权限信息
     *
     * @param privilegeQueryDTO 查询对象
     * @return List
     */
    List<PrivilegeGrantAuditVo> findPrivilegeGrantAuditVo(PrivilegeQueryDTO privilegeQueryDTO);

    /**
     * 联表查询权限授权记录（包含组织路径信息） 优化说明：通过联表查询直接获取组织的org_path，避免后续递归查询
     *
     * @param permissionDto 权限查询参数
     * @return 包含组织路径的权限授权记录列�?
     */
    List<PrivilegeGrantWithOrgPath> selectResourceGrantsWithOrgPath(
        @Param("permissionDto") PermissionDto permissionDto);

    List<Long> getAllAdminUserIds(@Param("resourceId") Long resourceId);

    List<Map<String, Object>> getAgentSubNum(PrivListQo request);

    List<ManPrivDto> queryAllManPrivInfo(@Param("resourceIds") List<Long> resourceIds);

    /**
     * 查询资源成员授权明细
     */
    List<ResourceMemberItemVo> queryResourceMembers(@Param("resourceId") Long resourceId,
        @Param("resourceBizType") String resourceBizType, @Param("grantTypes") List<String> grantTypes);

    List<ResourceAuthVo> listResource(ResourceAuthQo resourceAuthQo);

    List<DigitalEmployeeAuthVo> listDigitalEmployeeAuthByUser(AuthQo authQo);
}
