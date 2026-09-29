package com.iwhalecloud.byai.manager.domain.enterprise.service;

import com.iwhalecloud.byai.manager.entity.enterprise.TenantUserMembership;
import com.iwhalecloud.byai.manager.mapper.enterprise.EnterpriseInfoMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EnterpriseInfoServiceTest {

    private EnterpriseInfoMapper enterpriseInfoMapper;

    private TenantUserMembershipService tenantUserMembershipService;

    private EnterpriseInfoService service;

    @BeforeEach
    void setUp() {
        enterpriseInfoMapper = mock(EnterpriseInfoMapper.class);
        tenantUserMembershipService = mock(TenantUserMembershipService.class);
        service = new EnterpriseInfoService();
        ReflectionTestUtils.setField(service, "enterpriseInfoMapper", enterpriseInfoMapper);
        ReflectionTestUtils.setField(service, "tenantUserMembershipService", tenantUserMembershipService);
    }

    @Test
    void getEnterpriseIdPrefersEarliestAssociatedTenant() {
        TenantUserMembership newer = new TenantUserMembership();
        newer.setEnterpriseId(30L);
        TenantUserMembership earliest = new TenantUserMembership();
        earliest.setEnterpriseId(21L);
        when(tenantUserMembershipService.findActiveByUserId(7L)).thenReturn(List.of(newer, earliest));

        assertThat(service.getEnterpriseId(7L)).isEqualTo(21L);
        verify(enterpriseInfoMapper, never()).getEnterpriseId();
    }

    @Test
    void getEnterpriseIdFallsBackToMinWhenUserHasNoTenant() {
        when(tenantUserMembershipService.findActiveByUserId(7L)).thenReturn(List.of());
        when(enterpriseInfoMapper.getEnterpriseId()).thenReturn(99L);

        assertThat(service.getEnterpriseId(7L)).isEqualTo(99L);
    }

    @Test
    void getEnterpriseIdWithoutUserUsesMin() {
        when(enterpriseInfoMapper.getEnterpriseId()).thenReturn(99L);

        assertThat(service.getEnterpriseId(null)).isEqualTo(99L);
        verify(tenantUserMembershipService, never()).findActiveByUserId(any());
    }
}
