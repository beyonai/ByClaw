package com.iwhalecloud.byai.manager.mapper.tenant;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface TenantAdminMemberMapper {

    List<TenantMemberRow> selectMembers(@Param("enterpriseId") long enterpriseId);

    String selectPackageSnapshotForUpdate(@Param("enterpriseId") long enterpriseId);

    String selectProvisionState(@Param("enterpriseId") long enterpriseId);

    TenantMemberRow selectActiveUserByCode(@Param("userCode") String userCode);

    TenantMemberRow selectMember(@Param("enterpriseId") long enterpriseId, @Param("userId") long userId);

    int countActiveMembers(@Param("enterpriseId") long enterpriseId);

    int insertMember(@Param("membershipId") long membershipId, @Param("enterpriseId") long enterpriseId,
                     @Param("userId") long userId,
                     @Param("createdBy") long createdBy);
}
