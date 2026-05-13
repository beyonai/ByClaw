package com.iwhalecloud.byai.manager.mapper.organization;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.qo.organization.OrgManagerQo;
import com.iwhalecloud.byai.manager.qo.organization.OrgTreeQo;
import com.iwhalecloud.byai.manager.qo.organization.SearchOrgQo;
import com.iwhalecloud.byai.manager.vo.organization.BelongOrgManagerVo;
import com.iwhalecloud.byai.manager.vo.organization.OrgManagerVo;
import com.iwhalecloud.byai.manager.vo.organization.OrgTreeVo;
import com.iwhalecloud.byai.manager.vo.organization.OrganizationVo;
import com.iwhalecloud.byai.manager.dto.openapi.BelongOrgManagerDTO;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import org.apache.ibatis.annotations.MapKey;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

public interface OrganizationMapper extends BaseMapper<Organization> {

    /**
     * 查询组织
     *
     * @param userId 用户标识
     * @return UsersOrganization
     */
    List<UsersOrganization> getUsersOrganization(@Param("userId") Long userId);

    /***
     * 查询组织详情
     *
     * @param searchOrgQo 入参
     * @return OrganizationVo
     */
    OrganizationVo searchOrg(SearchOrgQo searchOrgQo);

    /**
     * 查询组织列表
     *
     * @param orgTreeQo 入参
     * @return ResponseUtil
     */
    List<OrgTreeVo> getOrgTree(OrgTreeQo orgTreeQo);

    /**
     * @param parentOrgId 父组织
     * @return Long
     */
    Long countByParentOrgId(@Param("parentOrgId") Long parentOrgId);

    /**
     * 查询名称重复的记录
     *
     * @param orgName 组织名称
     * @param orgCode 组织编码
     * @param orgIdNoEqual 组织标识不相等
     * @return Long
     */
    Long countDuplicate(@Param("orgName") String orgName, @Param("orgCode") String orgCode,
        @Param("orgIdNoEqual") Long orgIdNoEqual);

    /**
     * @param orgManagerQo 组织归属管理员
     * @return List<OrgManagerVo>
     */
    List<OrgManagerVo> qryByUserType(OrgManagerQo orgManagerQo);

    /**
     * 查询用户所挂载的所有组织
     *
     * @param userId 组织标识
     * @return Organization
     */
    List<Organization> findOrganizationByUserId(@Param("userId") Long userId);

    /**
     * 查询组织下的用户
     *
     * @param orgId
     * @return
     */
    Long countUsersByOrgId(@Param("userId") Long orgId);

    Long getFirstOrgId();

    /**
     * 获取下属及其自己组织
     *
     * @return List<Long>
     */
    List<Long> selectUnderlingList(@Param("pathCode") String pathCode);

    /**
     * 根据orgId获取下属及其自己组织
     *
     * @return List<Long>
     */
    List<Long> getCurrentAndBeyondOrgIdList(@Param("orgIdList") List<Long> orgIdList);

    /**
     * 外系统唯一标识查询
     * 
     * @param unionId 唯一标识
     * @return Organization
     */
    Organization findByUnionId(@Param("unionId") String unionId);

    /***
     * 查询组织的所有归属管理员(包括父级)
     *
     * @param belongOrgManagerDTO 查询对象
     * @return Collection
     */
    List<BelongOrgManagerVo> qryAllBelongOrgManagers(BelongOrgManagerDTO belongOrgManagerDTO);

    /**
     * 查询组织列表（包含子组织数量）
     *
     * @param orgTreeQo 入参
     * @return ResponseUtil
     */
    List<OrgTreeVo> getOpenOrgTree(OrgTreeQo orgTreeQo);

    /**
     * 批量查询组织信息（包含路径名称），基于path_code构建路径
     * 这是性能最优的查询方式，单次SQL获取所有组织及其完整路径
     *
     * @param orgIds 组织ID列表
     * @return List<Map<String, Object>> 组织ID到组织信息的映射
     */
    @MapKey("orgId")
    List<Map<String, Object>> selectOrganizationsWithPathNames(@Param("orgIds") List<Long> orgIds);

    List<Long> getTopOrgList();
}
