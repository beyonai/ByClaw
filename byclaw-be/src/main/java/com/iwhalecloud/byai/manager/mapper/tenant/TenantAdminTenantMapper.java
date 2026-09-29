package com.iwhalecloud.byai.manager.mapper.tenant;

import java.util.List;
import java.time.LocalDateTime;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface TenantAdminTenantMapper {

    TenantPackageRow selectEnabledPackage(@Param("packageId") long packageId);

    List<TenantPackageRow> selectEnabledPackages();

    TenantAdminTenantRow selectByRequestId(@Param("requestId") String requestId);

    List<TenantAdminTenantRow> selectTenants(@Param("name") String name,
                                            @Param("createdFrom") LocalDateTime createdFrom,
                                            @Param("createdTo") LocalDateTime createdTo,
                                            @Param("sortField") String sortField,
                                            @Param("sortOrder") String sortOrder);

    int insertEnterprise(@Param("enterpriseId") long enterpriseId, @Param("name") String name);

    int insertConfig(@Param("id") long id, @Param("enterpriseId") long enterpriseId, @Param("code") String code,
                     @Param("value") String value);

    int insertOwner(@Param("membershipId") long membershipId, @Param("enterpriseId") long enterpriseId,
                    @Param("userId") long userId);

    String selectConfig(@Param("enterpriseId") long enterpriseId, @Param("code") String code);

    int updateConfig(@Param("enterpriseId") long enterpriseId, @Param("code") String code,
                     @Param("value") String value);

    int deleteConfig(@Param("enterpriseId") long enterpriseId, @Param("code") String code);

    List<TenantConfigRow> selectConfigs(@Param("enterpriseId") long enterpriseId);

    String selectManagedEnterpriseName(@Param("enterpriseId") long enterpriseId);

    List<Long> selectPendingDeletions();

    int deleteTenantMemberships(@Param("enterpriseId") long enterpriseId);

    int deleteTenantOrganizations(@Param("enterpriseId") long enterpriseId);

    int deleteTenantResourceConfigs(@Param("enterpriseId") long enterpriseId);
}
