package com.iwhalecloud.byai.manager.mapper.tenant;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface TenantOrganizationMapper {

    List<TenantOrgNodeRow> selectOrganizationTree(@Param("enterpriseId") long enterpriseId);

    List<Long> selectBranchOrgIds(@Param("orgId") long orgId);

    List<TenantMemberRow> selectActiveUsersByOrgIds(@Param("orgIds") List<Long> orgIds);

    List<Long> selectAttachedOrgIds(@Param("enterpriseId") long enterpriseId);

    int insertAttachment(@Param("enterpriseId") long enterpriseId, @Param("orgId") long orgId,
                         @Param("addedBy") long addedBy);
}
