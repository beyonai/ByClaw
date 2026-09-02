package com.iwhalecloud.byai.manager.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.superassist.SuasSuperassistApplicationService;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.resource.request.DigEmployeeRelResourceQo;
import com.iwhalecloud.byai.manager.domain.resource.request.ResourceUseAuthQo;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.qo.auth.AuthQo;
import com.iwhalecloud.byai.manager.qo.auth.DigitalEmployeeAuthQo;
import com.iwhalecloud.byai.manager.vo.auth.DigitalEmployeeAuthVo;
import com.iwhalecloud.byai.manager.vo.auth.ResourceAuthVo;
import com.iwhalecloud.byai.state.domain.index.service.IndexService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceAuthContextService;

@ExtendWith(MockitoExtension.class)
class ResourceAuthApplicationServiceTest {

    @Mock
    private SsResourceMapper ssResourceMapper;

    @Mock
    private SsResourceCatalogService ssResourceCatalogService;

    @Mock
    private SuasSuperassistApplicationService suasSuperassistApplicationService;

    @Mock
    private PrivilegeGrantService privilegeGrantService;

    @Mock
    private AuthApplicationService authApplicationService;

    @Mock
    private ResourceAuthContextService resourceAuthContextService;

    @Mock
    private IndexService indexService;

    @Mock
    private OrganizationService organizationService;

    @Mock
    private UserService userService;

    @Test
    void listDigitalEmployeeRelResourceAuth_routesSkillQueryToSkillMapper() {
        ResourceAuthApplicationService service = service();
        DigEmployeeRelResourceQo qo = new DigEmployeeRelResourceQo();
        qo.setResourceId(10001L);
        qo.setResourceBizTypeList(List.of("SKILL"));
        when(ssResourceCatalogService.findSelfAndDescendantCatalogIds(null)).thenReturn(Collections.emptyList());
        when(ssResourceMapper.queryDigEmployeeSkillResourceAuthList(qo)).thenReturn(Collections.emptyList());

        service.listDigitalEmployeeRelResourceAuth(qo);

        verify(ssResourceMapper).queryDigEmployeeSkillResourceAuthList(qo);
        verify(ssResourceMapper, never()).queryDigEmployeeRelResourceAuthList(qo);
    }

    @Test
    void listDigitalEmployeeRelResourceAuth_keepsExistingMapperForNonSkillQuery() {
        ResourceAuthApplicationService service = service();
        DigEmployeeRelResourceQo qo = new DigEmployeeRelResourceQo();
        qo.setResourceId(10001L);
        qo.setResourceBizTypeList(List.of("KG_DOC"));
        when(ssResourceCatalogService.findSelfAndDescendantCatalogIds(null)).thenReturn(Collections.emptyList());
        when(ssResourceMapper.queryDigEmployeeRelResourceAuthList(qo)).thenReturn(Collections.emptyList());

        service.listDigitalEmployeeRelResourceAuth(qo);

        verify(ssResourceMapper).queryDigEmployeeRelResourceAuthList(qo);
        verify(ssResourceMapper, never()).queryDigEmployeeSkillResourceAuthList(qo);
    }

    @Test
    void listResourceAuth_doesNotFetchOperationPermissionsForSkillOptions() {
        ResourceUseAuthQo qo = new ResourceUseAuthQo();
        ResourceAuthVo resource = new ResourceAuthVo();
        resource.setResourceId(21L);
        PageInfo<ResourceAuthVo> page = new PageInfo<>();
        page.setList(List.of(resource));
        when(privilegeGrantService.listResourceAuth(qo)).thenReturn(page);

        ResourceAuthApplicationService service = service();
        service.listResourceAuth(qo);

        verify(authApplicationService, never()).queryResourceOperationPermissionsBatch(any());
        org.junit.jupiter.api.Assertions.assertTrue(Arrays.stream(ResourceAuthVo.class.getDeclaredFields())
            .noneMatch(field -> "hasUsePermission".equals(field.getName())));
    }

    @Test
    void listDigitalEmployeeAuthByUser_usesAncestorOrganizationsForPermissionCalculation() {
        Users user = new Users();
        user.setUserId(1001L);
        UsersOrganization directOrganization = new UsersOrganization();
        directOrganization.setOrgId(20L);
        directOrganization.setPositionId(30L);
        when(userService.findById(1001L)).thenReturn(user);
        when(organizationService.findUsersOrganizationByUserId(1001L)).thenReturn(List.of(directOrganization));
        when(organizationService.findEffectiveOrganizationIdsByUserId(1001L)).thenReturn(Set.of(10L, 20L));
        PageInfo<DigitalEmployeeAuthVo> emptyPage = new PageInfo<>();
        emptyPage.setList(List.of());
        when(privilegeGrantService.listDigitalEmployeeAuthByUser(any())).thenReturn(emptyPage);

        DigitalEmployeeAuthQo qo = new DigitalEmployeeAuthQo();
        qo.setGrantToObjId(1001L);
        service().listDigitalEmployeeAuthByUser(qo);

        ArgumentCaptor<AuthQo> captor = ArgumentCaptor.forClass(AuthQo.class);
        verify(privilegeGrantService).listDigitalEmployeeAuthByUser(captor.capture());
        assertThat(captor.getValue().getUserOrgIds()).containsExactlyInAnyOrder(10L, 20L);
        assertThat(captor.getValue().getUserPositionIds()).containsExactly(30L);
    }

    private ResourceAuthApplicationService service() {
        ResourceAuthApplicationService service = new ResourceAuthApplicationService();
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        ReflectionTestUtils.setField(service, "ssResourceCatalogService", ssResourceCatalogService);
        ReflectionTestUtils.setField(service, "suasSuperassistApplicationService", suasSuperassistApplicationService);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        ReflectionTestUtils.setField(service, "resourceAuthContextService", resourceAuthContextService);
        ReflectionTestUtils.setField(service, "indexService", indexService);
        ReflectionTestUtils.setField(service, "organizationService", organizationService);
        ReflectionTestUtils.setField(service, "userService", userService);
        return service;
    }
}
