package com.iwhalecloud.byai.manager.application.service.auth;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.domain.auth.enums.Color;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantType;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.dto.auth.AuthDTO;
import com.iwhalecloud.byai.manager.dto.auth.AuthRedBlackDTO;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DigitalEmployeeGroupAuthorizationBackfillServiceTest {
    private final DigitalEmployeeGroupAuthorizationBackfillService backfill =
        new DigitalEmployeeGroupAuthorizationBackfillService();
    private final SsResourceMapper resources = mock(SsResourceMapper.class);
    private final PrivilegeGrantService grants = mock(PrivilegeGrantService.class);
    private final DigitalEmployeeGroupAuthorizationService groups = mock(DigitalEmployeeGroupAuthorizationService.class);
    private final AuthApplicationService auth = mock(AuthApplicationService.class);

    DigitalEmployeeGroupAuthorizationBackfillServiceTest() {
        ReflectionTestUtils.setField(backfill, "resourceMapper", resources);
        ReflectionTestUtils.setField(backfill, "privilegeGrantService", grants);
        ReflectionTestUtils.setField(backfill, "groupAuthorizationService", groups);
        ReflectionTestUtils.setField(backfill, "authApplicationService", auth);
        lenient().when(grants.findPrivilegeGrant(any(), any(), any(), any()))
            .thenReturn(Collections.emptyList());
    }

    @Test
    void fillsMissingOrganizationGrantAndPreservesExistingTargets() {
        SsResource group = new SsResource();
        group.setResourceId(1L);
        group.setResourceBizType("DIG_EMPLOYEE");
        group.setResourceStatus(2);
        when(resources.selectById(1L)).thenReturn(group);
        when(grants.findPrivilegeGrant(GrantType.FORCE_USE, "DIG_EMPLOYEE", 1L, Color.RED))
            .thenReturn(List.of(grant("ORG", 100L)));
        AuthRedBlackDTO memberAuth = new AuthRedBlackDTO();
        memberAuth.setGrantType(GrantType.FORCE_USE);
        memberAuth.setGrantObjType("DIG_EMPLOYEE");
        memberAuth.setGrantObjId(2L);
        memberAuth.setRedList(List.of(target("USER", 200L), target("ORG", 100L)));
        memberAuth.setBlackList(List.of());
        when(groups.buildMemberAuthorizations(any(), any())).thenReturn(List.of(memberAuth));
        when(grants.findPrivilegeGrant(GrantType.FORCE_USE, "DIG_EMPLOYEE", 2L, Color.RED))
            .thenReturn(List.of(grant("USER", 200L)));

        assertThat(backfill.backfillGroup(1L)).isEqualTo(1);
        verify(auth).handleAuth(memberAuth);
    }

    @Test
    void skipsAlreadySynchronizedAuthorizationOnRestart() {
        SsResource group = new SsResource();
        group.setResourceId(1L);
        group.setResourceBizType("DIG_EMPLOYEE");
        group.setResourceStatus(2);
        when(resources.selectById(1L)).thenReturn(group);
        when(grants.findPrivilegeGrant(GrantType.FORCE_USE, "DIG_EMPLOYEE", 1L, Color.RED))
            .thenReturn(List.of(grant("ORG", 100L)));
        AuthRedBlackDTO memberAuth = new AuthRedBlackDTO();
        memberAuth.setGrantType(GrantType.FORCE_USE);
        memberAuth.setGrantObjType("DIG_EMPLOYEE");
        memberAuth.setGrantObjId(2L);
        memberAuth.setRedList(List.of(target("ORG", 100L)));
        memberAuth.setBlackList(List.of());
        when(groups.buildMemberAuthorizations(any(), any())).thenReturn(List.of(memberAuth));
        when(grants.findPrivilegeGrant(GrantType.FORCE_USE, "DIG_EMPLOYEE", 2L, Color.RED))
            .thenReturn(List.of(grant("ORG", 100L)));

        assertThat(backfill.backfillGroup(1L)).isZero();
        verify(auth, never()).handleAuth(any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"FORCE_USE", "ALLOW_MANAGE"})
    void startupOnlyBackfillsMemberEmployeesWithoutResourceGrants(String grantType) {
        // 使用真实组授权计划生成器，确保启动补齐只作用于组员员工。
        var planner = new DigitalEmployeeGroupAuthorizationService();
        var employees = mock(SsResExtDigEmployeeService.class);
        var relations = mock(SsResourceRelDetailService.class);
        ReflectionTestUtils.setField(planner, "employeeService", employees);
        ReflectionTestUtils.setField(planner, "relationService", relations);
        ReflectionTestUtils.setField(planner, "resourceMapper", resources);
        ReflectionTestUtils.setField(planner, "privilegeGrantService", grants);
        ReflectionTestUtils.setField(backfill, "groupAuthorizationService", planner);

        SsResource group = resource(1L, "DIG_EMPLOYEE");
        when(resources.selectById(1L)).thenReturn(group);
        when(resources.selectById(2L)).thenReturn(resource(2L, "DIG_EMPLOYEE"));
        when(resources.selectById(7L)).thenReturn(resource(7L, "SKILL"));
        when(resources.selectById(8L)).thenReturn(resource(8L, "KG_DOC"));
        SsResExtDigEmployee ext = new SsResExtDigEmployee();
        ext.setAgentType("017");
        when(employees.findById(1L)).thenReturn(ext);
        when(relations.list(any(LambdaQueryWrapper.class))).thenReturn(List.of(relation(2L)));
        when(relations.findByResourceId(1L)).thenReturn(List.of(relation(7L)));
        when(relations.findByResourceId(2L)).thenReturn(List.of(relation(8L)));
        when(grants.findPrivilegeGrant(grantType, "DIG_EMPLOYEE", 1L, Color.RED))
            .thenReturn(List.of(grant("ORG", 100L)));

        assertThat(backfill.backfillGroup(1L)).isEqualTo(1);

        var written = ArgumentCaptor.forClass(AuthRedBlackDTO.class);
        verify(auth).handleAuth(written.capture());
        assertThat(written.getAllValues()).extracting(AuthRedBlackDTO::getGrantObjId)
            .containsExactlyElementsOf(List.of(2L));
        assertThat(written.getAllValues()).allSatisfy(authorization -> {
            assertThat(authorization.getGrantType()).isEqualTo(grantType);
            assertThat(authorization.getRedList()).extracting(AuthDTO::getGrantToObjId).containsExactly(100L);
        });
    }

    private static SsResource resource(Long id, String type) {
        SsResource resource = new SsResource();
        resource.setResourceId(id);
        resource.setResourceBizType(type);
        resource.setResourceStatus(2);
        resource.setComAcctId(10L);
        return resource;
    }

    private static SsResourceRelDetail relation(Long id) {
        SsResourceRelDetail relation = new SsResourceRelDetail();
        relation.setRelResourceId(id);
        return relation;
    }

    private static PrivilegeGrant grant(String type, Long id) {
        PrivilegeGrant grant = new PrivilegeGrant();
        grant.setGrantToObjType(type);
        grant.setGrantToObjId(id);
        return grant;
    }

    private static AuthDTO target(String type, Long id) {
        AuthDTO target = new AuthDTO();
        target.setGrantToObjType(type);
        target.setGrantToObjId(id);
        return target;
    }
}
