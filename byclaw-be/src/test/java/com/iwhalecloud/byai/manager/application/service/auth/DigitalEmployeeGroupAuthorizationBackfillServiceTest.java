package com.iwhalecloud.byai.manager.application.service.auth;

import com.iwhalecloud.byai.manager.domain.auth.enums.Color;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantType;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.dto.auth.AuthDTO;
import com.iwhalecloud.byai.manager.dto.auth.AuthRedBlackDTO;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.lenient;
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
        AuthRedBlackDTO skillAuth = new AuthRedBlackDTO();
        skillAuth.setGrantType(GrantType.FORCE_USE);
        skillAuth.setGrantObjType("SKILL");
        skillAuth.setGrantObjId(2L);
        skillAuth.setRedList(List.of(target("USER", 200L), target("ORG", 100L)));
        skillAuth.setBlackList(List.of());
        when(groups.buildMemberAuthorizations(any(), any())).thenReturn(List.of(skillAuth));
        when(grants.findPrivilegeGrant(GrantType.FORCE_USE, "SKILL", 2L, Color.RED))
            .thenReturn(List.of(grant("USER", 200L)));

        assertThat(backfill.backfillGroup(1L)).isEqualTo(1);
        verify(auth).handleAuth(skillAuth);
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
        AuthRedBlackDTO skillAuth = new AuthRedBlackDTO();
        skillAuth.setGrantType(GrantType.FORCE_USE);
        skillAuth.setGrantObjType("SKILL");
        skillAuth.setGrantObjId(2L);
        skillAuth.setRedList(List.of(target("ORG", 100L)));
        skillAuth.setBlackList(List.of());
        when(groups.buildMemberAuthorizations(any(), any())).thenReturn(List.of(skillAuth));
        when(grants.findPrivilegeGrant(GrantType.FORCE_USE, "SKILL", 2L, Color.RED))
            .thenReturn(List.of(grant("ORG", 100L)));

        assertThat(backfill.backfillGroup(1L)).isZero();
        verify(auth, never()).handleAuth(any());
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
