package com.iwhalecloud.byai.manager.application.service.skillgroup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeRuntimeRefreshService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.model.SkillRelationSource;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.skillgroup.event.SkillUsePermissionChangedEvent;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SkillGroupMapper;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

class SkillInstallSourceReconciliationServiceTest {

    private static final Long TENANT_ID = 201L;
    private static final Long SKILL_ID = 301L;

    private SsResourceService resourceService;
    private SsResourceRelDetailService relationService;
    private SkillGroupMapper mapper;
    private AuthApplicationService authService;
    private DigitalEmployeeRuntimeRefreshService refreshService;
    private SkillInstallSourceReconciliationService service;

    @BeforeEach
    void setUp() {
        resourceService = mock(SsResourceService.class);
        relationService = mock(SsResourceRelDetailService.class);
        mapper = mock(SkillGroupMapper.class);
        authService = mock(AuthApplicationService.class);
        refreshService = mock(DigitalEmployeeRuntimeRefreshService.class);
        service = new SkillInstallSourceReconciliationService(
            resourceService, relationService, mapper, authService, refreshService);
        when(resourceService.findById(SKILL_ID)).thenReturn(skill());
        when(authService.hasResourceUsePermission(any(SsResource.class), any())).thenReturn(false);
        when(relationService.updateById(any())).thenReturn(true);
        when(relationService.removeById(any(Long.class))).thenReturn(true);
    }

    @Test
    void listenerRunsBeforeCommitSoFailuresRollbackTheAuthTransaction() throws Exception {
        TransactionalEventListener annotation = SkillInstallSourceReconciliationService.class
            .getMethod("reconcile", SkillUsePermissionChangedEvent.class)
            .getAnnotation(TransactionalEventListener.class);

        assertThat(annotation).isNotNull();
        assertThat(annotation.phase()).isEqualTo(TransactionPhase.BEFORE_COMMIT);
    }

    @Test
    void eventDefensivelyCopiesAndFiltersAffectedUsers() {
        java.util.LinkedHashSet<Long> users = new java.util.LinkedHashSet<>(List.of(22L, 11L));
        users.add(null);

        SkillUsePermissionChangedEvent event = new SkillUsePermissionChangedEvent(SKILL_ID, TENANT_ID, users, 9L);
        users.clear();

        assertThat(event.affectedUserIds()).containsExactly(11L, 22L);
        assertThatThrownBy(() -> event.affectedUserIds().add(33L)).isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void removesOnlyRevokedInstallerAndPreservesOtherInstallers() {
        SsResourceRelDetail relation = relation(1L, 402L,
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[701,702],\"legacySourceGroupIds\":[],"
                + "\"groupInstallers\":{\"701\":[11,22],\"702\":[11]}}");
        stubEmployee(402L, relation);
        when(authService.hasResourceUsePermission(any(), eq(11L))).thenReturn(false);
        when(authService.hasResourceUsePermission(any(), eq(22L))).thenReturn(true);

        service.reconcile(new SkillUsePermissionChangedEvent(SKILL_ID, TENANT_ID, Set.of(11L, 22L), 9L));

        ArgumentCaptor<SsResourceRelDetail> updated = ArgumentCaptor.forClass(SsResourceRelDetail.class);
        verify(relationService).updateById(updated.capture());
        SkillRelationSource remaining = SkillRelationSource.parse(updated.getValue().getRelResourceInfo());
        assertThat(remaining.getGroupInstallers()).containsOnlyKeys(701L);
        assertThat(remaining.getGroupInstallers().get(701L)).containsExactly(22L);
        verify(refreshService).scheduleSkillRuntimeRefreshAfterCommit(List.of(402L));
    }

    @Test
    void deletesLastAttributedSource() {
        SsResourceRelDetail relation = relation(2L, 402L, source(false, "\"701\":[11]"));
        stubEmployee(402L, relation);

        service.reconcile(event(11L));

        verify(relationService).removeById(2L);
        verify(refreshService).scheduleSkillRuntimeRefreshAfterCommit(List.of(402L));
    }

    @Test
    void preservesManualAndLegacySources() {
        SsResourceRelDetail manual = relation(3L, 402L, source(true, "\"701\":[11]"));
        SsResourceRelDetail legacy = relation(4L, 402L,
            "{\"manual\":false,\"sourceGroupIds\":[800]}");
        stubEmployee(402L, manual, legacy);

        service.reconcile(event(11L));

        verify(relationService).updateById(manual);
        verify(relationService, never()).removeById(any(Long.class));
        assertThat(SkillRelationSource.parse(manual.getRelResourceInfo()).isManual()).isTrue();
        assertThat(legacy.getRelResourceInfo()).isEqualTo("{\"manual\":false,\"sourceGroupIds\":[800]}");
    }

    @Test
    void leavesMalformedRowsUntouched() {
        SsResourceRelDetail malformedV1 = relation(5L, 402L, "{\"manual\":false,\"sourceGroupIds\":[800,\"bad\"]}");
        SsResourceRelDetail malformedV2 = relation(6L, 402L,
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[701],\"legacySourceGroupIds\":[],"
                + "\"groupInstallers\":{\"701\":[11]},\"unknown\":true}");
        stubEmployee(402L, malformedV1, malformedV2);

        service.reconcile(event(11L));

        verify(relationService, never()).updateById(any());
        verify(relationService, never()).removeById(any(Long.class));
        verify(refreshService, never()).scheduleSkillRuntimeRefreshAfterCommit(any());
    }

    @Test
    void alternativeEffectivePermissionLeavesRelationUnchanged() {
        SsResourceRelDetail relation = relation(7L, 402L, source(false, "\"701\":[11]"));
        stubEmployee(402L, relation);
        when(authService.hasResourceUsePermission(any(), eq(11L))).thenReturn(true);

        service.reconcile(event(11L));

        verify(mapper, never()).selectDigitalEmployeeForUpdate(any(), any());
        verify(relationService, never()).updateById(any());
        verify(refreshService, never()).scheduleSkillRuntimeRefreshAfterCommit(any());
    }

    @Test
    void locksEmployeesAscendingRereadsDuplicatesAndDedupesRefresh() {
        SsResourceRelDetail first = relation(8L, 500L, source(false, "\"701\":[11]"));
        SsResourceRelDetail duplicate = relation(9L, 500L, source(false, "\"702\":[11]"));
        SsResourceRelDetail second = relation(10L, 400L, source(false, "\"703\":[11]"));
        when(mapper.selectActiveEmployeeSkillRelationsBySkill(SKILL_ID, TENANT_ID))
            .thenReturn(List.of(first, duplicate, second));
        when(mapper.selectDigitalEmployeeForUpdate(400L, TENANT_ID)).thenReturn(employee(400L));
        when(mapper.selectDigitalEmployeeForUpdate(500L, TENANT_ID)).thenReturn(employee(500L));
        when(mapper.selectDigitalEmployeeSkillRelations(400L, List.of(SKILL_ID))).thenReturn(List.of(second));
        when(mapper.selectDigitalEmployeeSkillRelations(500L, List.of(SKILL_ID))).thenReturn(List.of(first, duplicate));

        service.reconcile(event(11L));

        InOrder order = inOrder(resourceService, mapper, relationService, refreshService);
        order.verify(resourceService).findById(SKILL_ID);
        order.verify(mapper).selectActiveEmployeeSkillRelationsBySkill(SKILL_ID, TENANT_ID);
        order.verify(mapper).selectDigitalEmployeeForUpdate(400L, TENANT_ID);
        order.verify(mapper).selectDigitalEmployeeSkillRelations(400L, List.of(SKILL_ID));
        order.verify(relationService).removeById(10L);
        order.verify(mapper).selectDigitalEmployeeForUpdate(500L, TENANT_ID);
        order.verify(mapper).selectDigitalEmployeeSkillRelations(500L, List.of(SKILL_ID));
        order.verify(relationService).removeById(8L);
        order.verify(relationService).removeById(9L);
        order.verify(refreshService).scheduleSkillRuntimeRefreshAfterCommit(List.of(400L, 500L));
    }

    @Test
    void reconciliationFailurePropagatesAndDoesNotScheduleRefresh() {
        SsResourceRelDetail relation = relation(11L, 402L, source(false, "\"701\":[11]"));
        stubEmployee(402L, relation);
        when(relationService.removeById(11L)).thenThrow(new IllegalStateException("write failed"));

        assertThatThrownBy(() -> service.reconcile(event(11L)))
            .isInstanceOf(IllegalStateException.class).hasMessage("write failed");
        verify(refreshService, never()).scheduleSkillRuntimeRefreshAfterCommit(any());
    }

    private SkillUsePermissionChangedEvent event(Long... userIds) {
        return new SkillUsePermissionChangedEvent(SKILL_ID, TENANT_ID, Set.of(userIds), 9L);
    }

    private void stubEmployee(Long employeeId, SsResourceRelDetail... relations) {
        when(mapper.selectActiveEmployeeSkillRelationsBySkill(SKILL_ID, TENANT_ID)).thenReturn(List.of(relations));
        when(mapper.selectDigitalEmployeeForUpdate(employeeId, TENANT_ID)).thenReturn(employee(employeeId));
        when(mapper.selectDigitalEmployeeSkillRelations(employeeId, List.of(SKILL_ID))).thenReturn(List.of(relations));
    }

    private SsResource skill() {
        SsResource skill = new SsResource();
        skill.setResourceId(SKILL_ID);
        skill.setComAcctId(TENANT_ID);
        skill.setResourceBizType(ResourceBizTypeEnum.SKILL.name());
        skill.setResourceStatus(ResourceStatus.LIST.getNum());
        return skill;
    }

    private SsResource employee(Long id) {
        SsResource employee = new SsResource();
        employee.setResourceId(id);
        employee.setComAcctId(TENANT_ID);
        employee.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        return employee;
    }

    private SsResourceRelDetail relation(Long id, Long employeeId, String source) {
        SsResourceRelDetail relation = new SsResourceRelDetail();
        relation.setResourceRelDetailId(id);
        relation.setResourceId(employeeId);
        relation.setRelResourceId(SKILL_ID);
        relation.setRelResourceInfo(source);
        relation.setRelTypeName("DIG_EMPLOYEE_SKILL");
        relation.setRelStatus(1);
        return relation;
    }

    private String source(boolean manual, String installers) {
        return "{\"version\":2,\"manual\":" + manual + ",\"sourceGroupIds\":["
            + (installers.contains("701") ? "701" : installers.contains("702") ? "702" : "703")
            + "],\"legacySourceGroupIds\":[],\"groupInstallers\":{" + installers + "}}";
    }
}
