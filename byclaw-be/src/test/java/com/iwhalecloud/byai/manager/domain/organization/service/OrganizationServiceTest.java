package com.iwhalecloud.byai.manager.domain.organization.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.mapper.organization.OrganizationMapper;

class OrganizationServiceTest {

    @Test
    void findEffectiveOrganizationIdsByUserId_includesAllAncestorsAndDirectOrganizations() {
        OrganizationService service = new OrganizationService();
        OrganizationMapper organizationMapper = mock(OrganizationMapper.class);
        ReflectionTestUtils.setField(service, "organizationMapper", organizationMapper);

        Organization childOrganization = new Organization();
        childOrganization.setOrgId(20L);
        childOrganization.setPathCode("-1.10.20");
        Organization anotherOrganization = new Organization();
        anotherOrganization.setOrgId(30L);
        anotherOrganization.setPathCode("-1.30");
        Organization organizationWithoutPath = new Organization();
        organizationWithoutPath.setOrgId(40L);
        when(organizationMapper.findOrganizationByUserId(1001L))
            .thenReturn(List.of(childOrganization, anotherOrganization, organizationWithoutPath));

        Set<Long> organizationIds = service.findEffectiveOrganizationIdsByUserId(1001L);

        assertThat(organizationIds).containsExactlyInAnyOrder(-1L, 10L, 20L, 30L, 40L);
    }
}
