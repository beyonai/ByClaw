package com.iwhalecloud.byai.manager.application.service.skillgroup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.skillgroup.model.SkillGroupMemberStatus;
import com.iwhalecloud.byai.manager.mapper.resource.SkillGroupMapper;
import com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupMemberVo;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.ArgumentCaptor;

class SkillGroupMemberStatusServiceTest {

    private static final Long EMPLOYEE_ID = 100L;
    private static final Long SKILL_ID = 200L;

    private AuthApplicationService authApplicationService;
    private SkillGroupMapper skillGroupMapper;
    private SkillGroupMemberStatusService service;

    @BeforeEach
    void setUp() {
        authApplicationService = mock(AuthApplicationService.class);
        skillGroupMapper = mock(SkillGroupMapper.class);
        service = new SkillGroupMemberStatusService(authApplicationService, skillGroupMapper);
    }

    @ParameterizedTest
    @MethodSource("statusPrecedence")
    void evaluatesAllStatusesWithPermissionPrecedence(
            boolean relationExists,
            Boolean hasUsePermission,
            Boolean canApplyUse,
            Boolean useApplyPending,
            SkillGroupMemberStatus expectedStatus,
            String expectedReason) {
        SkillGroupMemberVo member = member(SKILL_ID);
        when(authApplicationService.queryResourceOperationPermissionsBatch(List.of(SKILL_ID)))
                .thenReturn(Map.of(SKILL_ID, permissions(hasUsePermission, canApplyUse, useApplyPending)));
        when(skillGroupMapper.selectInstalledSkillIds(EMPLOYEE_ID, List.of(SKILL_ID)))
                .thenReturn(relationExists ? List.of(SKILL_ID) : List.of());

        List<SkillGroupMemberVo> result = service.evaluate(List.of(member), EMPLOYEE_ID);

        assertThat(result).containsExactly(member);
        assertThat(member.getMemberStatus()).isEqualTo(expectedStatus);
        assertThat(member.getInstalled()).isEqualTo(relationExists);
        assertThat(member.getHasUsePermission()).isEqualTo(Boolean.TRUE.equals(hasUsePermission));
        assertThat(member.getStatusReason()).isEqualTo(expectedReason);
    }

    private static Stream<Arguments> statusPrecedence() {
        return Stream.of(
                Arguments.of(true, true, false, false, SkillGroupMemberStatus.INSTALLED, null),
                Arguments.of(false, true, false, false, SkillGroupMemberStatus.INSTALLABLE, null),
                Arguments.of(true, false, true, true, SkillGroupMemberStatus.APPLY_PENDING, null),
                Arguments.of(true, false, true, false, SkillGroupMemberStatus.APPLY_REQUIRED, null),
                Arguments.of(true, false, false, false, SkillGroupMemberStatus.APPLY_UNAVAILABLE,
                        SkillGroupMemberStatusService.APPLY_UNAVAILABLE_REASON));
    }

    @Test
    void nullEmployeeSkipsRelationsAndAuthorizedMemberIsInstallable() {
        SkillGroupMemberVo member = member(SKILL_ID);
        when(authApplicationService.queryResourceOperationPermissionsBatch(List.of(SKILL_ID)))
                .thenReturn(Map.of(SKILL_ID, permissions(true, false, false)));

        service.evaluate(List.of(member), null);

        verify(skillGroupMapper, never()).selectInstalledSkillIds(any(), anyList());
        assertThat(member.getInstalled()).isFalse();
        assertThat(member.getMemberStatus()).isEqualTo(SkillGroupMemberStatus.INSTALLABLE);
    }

    @Test
    void missingPermissionFailsClosedWithGenericReason() {
        SkillGroupMemberVo member = member(SKILL_ID);
        when(authApplicationService.queryResourceOperationPermissionsBatch(List.of(SKILL_ID)))
                .thenReturn(Map.of());
        when(skillGroupMapper.selectInstalledSkillIds(EMPLOYEE_ID, List.of(SKILL_ID))).thenReturn(List.of(SKILL_ID));

        service.evaluate(List.of(member), EMPLOYEE_ID);

        assertThat(member.getInstalled()).isTrue();
        assertThat(member.getHasUsePermission()).isFalse();
        assertThat(member.getMemberStatus()).isEqualTo(SkillGroupMemberStatus.APPLY_UNAVAILABLE);
        assertThat(member.getStatusReason()).isEqualTo(SkillGroupMemberStatusService.APPLY_UNAVAILABLE_REASON);
    }

    @Test
    void preservesDuplicatesOrderAndObjectsWhileBatchingDistinctValidIds() {
        SkillGroupMemberVo first = member(201L);
        SkillGroupMemberVo duplicate = member(201L);
        SkillGroupMemberVo invalid = member(null);
        SkillGroupMemberVo last = member(202L);
        List<SkillGroupMemberVo> input = List.of(first, duplicate, invalid, last);
        when(authApplicationService.queryResourceOperationPermissionsBatch(List.of(201L, 202L)))
                .thenReturn(Map.of(
                        201L, permissions(true, false, false),
                        202L, permissions(false, true, false)));
        when(skillGroupMapper.selectInstalledSkillIds(EMPLOYEE_ID, List.of(201L, 202L)))
                .thenReturn(List.of(201L));

        List<SkillGroupMemberVo> result = service.evaluate(input, EMPLOYEE_ID);

        assertThat(result).isSameAs(input);
        assertThat(result).containsExactly(first, duplicate, invalid, last);
        assertThat(first.getMemberStatus()).isEqualTo(SkillGroupMemberStatus.INSTALLED);
        assertThat(duplicate.getMemberStatus()).isEqualTo(SkillGroupMemberStatus.INSTALLED);
        assertThat(invalid.getMemberStatus()).isEqualTo(SkillGroupMemberStatus.APPLY_UNAVAILABLE);
        assertThat(last.getMemberStatus()).isEqualTo(SkillGroupMemberStatus.APPLY_REQUIRED);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
        verify(authApplicationService).queryResourceOperationPermissionsBatch(ids.capture());
        assertThat(ids.getValue()).containsExactly(201L, 202L);
        verify(skillGroupMapper).selectInstalledSkillIds(EMPLOYEE_ID, List.of(201L, 202L));
    }

    @Test
    void nullAndEmptyMembersReturnEmptyWithoutQueries() {
        assertThat(service.evaluate(null, EMPLOYEE_ID)).isEmpty();
        assertThat(service.evaluate(List.of(), EMPLOYEE_ID)).isEmpty();

        verifyNoInteractions(authApplicationService, skillGroupMapper);
    }

    private static SkillGroupMemberVo member(Long resourceId) {
        SkillGroupMemberVo member = new SkillGroupMemberVo();
        member.setResourceId(resourceId);
        return member;
    }

    private static ResourceOperationPermissionsVo permissions(
            Boolean hasUsePermission, Boolean canApplyUse, Boolean useApplyPending) {
        ResourceOperationPermissionsVo permissions = new ResourceOperationPermissionsVo();
        permissions.setHasUsePermission(hasUsePermission);
        permissions.setCanApplyUse(canApplyUse);
        permissions.setUseApplyPending(useApplyPending);
        return permissions;
    }
}
