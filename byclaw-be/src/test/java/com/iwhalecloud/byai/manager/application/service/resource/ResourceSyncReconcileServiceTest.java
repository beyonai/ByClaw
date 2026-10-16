package com.iwhalecloud.byai.manager.application.service.resource;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.model.SkillRelationSource;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.*;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceSyncScopeMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.any;

class ResourceSyncReconcileServiceTest {
    private ResourceSyncReconcileService service;
    private SsResourceRelDetailService relations;
    private ResourceSyncScopeMapper defaults;
    private MemorySources sources;
    private ResourceSyncJob job;
    private SsResource resource;
    private SsResourceRelDetail relation;

    @BeforeEach void setup() {
        LoginInfo login = new LoginInfo(); login.setUserId(9L); login.setEnterpriseId(1L);
        CurrentUserHolder.setLoginInfo(login);
        service = new ResourceSyncReconcileService();
        relations = mock(SsResourceRelDetailService.class);
        defaults = mock(ResourceSyncScopeMapper.class);
        when(defaults.activeTenantUsers(any(), any())).thenAnswer(call -> call.getArgument(0));
        sources = new MemorySources();
        var resources = mock(SsResourceService.class);
        var auth = mock(AuthApplicationService.class);
        when(auth.hasResourceUsePermission(any(), any())).thenReturn(true);
        var extensions = mock(SsResExtDigEmployeeService.class);
        SsResExtDigEmployee extension = new SsResExtDigEmployee(); extension.setAgentType("001");
        when(extensions.findById(20L)).thenReturn(extension);
        resource = new SsResource(); resource.setResourceId(10L); resource.setResourceBizType("SKILL");
        resource.setResourceStatus(2); resource.setOwnerType("enterprise"); resource.setComAcctId(1L); resource.setThirdSyncRevision(2L);
        SsResource employee = new SsResource(); employee.setResourceId(20L); employee.setResourceBizType("DIG_EMPLOYEE");
        employee.setOwnerType("enterprise"); employee.setResourceStatus(2); employee.setComAcctId(1L);
        when(resources.findByIdForUpdate(10L)).thenReturn(resource);
        when(resources.findByIdForUpdate(20L)).thenReturn(employee);
        relation = new SsResourceRelDetail(); relation.setResourceRelDetailId(30L);
        relation.setResourceId(20L); relation.setRelResourceId(10L); relation.setComAcctId(1L);
        relation.setRelResourceInfo(SkillRelationSource.parse("{\"manual\":false,\"sourceGroupIds\":[]}").toJson());
        when(relations.list(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenAnswer(call -> List.of(relation));
        when(relations.removeById(any(java.io.Serializable.class))).thenReturn(true);
        ReflectionTestUtils.setField(service, "resources", resources);
        ReflectionTestUtils.setField(service, "relations", relations);
        ReflectionTestUtils.setField(service, "sources", sources);
        ReflectionTestUtils.setField(service, "scopeMapper", defaults);
        ReflectionTestUtils.setField(service, "auth", auth);
        ReflectionTestUtils.setField(service, "employeeExt", extensions);
        ReflectionTestUtils.setField(service, "employees", mock(DigitalEmployeeApplicationService.class));
        var sequence = mock(SequenceService.class); when(sequence.nextVal()).thenReturn(99L);
        ReflectionTestUtils.setField(service, "sequence", sequence);
        job = new ResourceSyncJob(); job.setComAcctId(1L); job.setResourceId(10L); job.setSyncRevision(2L);
        job.setOperatorUserId(9L); job.setAssociationMode("RECONCILE");
    }

    @AfterEach void cleanup() { CurrentUserHolder.setLoginInfo(null); }

    @Test void shrinkingScopeKeepsTheOtherUsersSourceAndPhysicalRelation() {
        sources.retain(1L, 20L, 10L, ResourceBindingSourceService.SYNC, 5L, 1L);
        sources.retain(1L, 20L, 10L, ResourceBindingSourceService.SYNC, 6L, 1L);
        when(defaults.defaultEmployeesForUpdate(6L, 1L)).thenReturn(List.of(20L));
        mutate(Set.of(6L));
        assertThat(sources.activeUsers()).containsExactly(6L);
        verify(relations, never()).removeById(any(java.io.Serializable.class));
    }

    @Test void lastAutomaticSourceRemovesOnlyTheAutomaticPhysicalRelation() {
        sources.retain(1L, 20L, 10L, ResourceBindingSourceService.SYNC, 5L, 1L);
        Map<String, Integer> result = mutate(Set.of());
        assertThat(result).containsEntry("removedSourceCount", 1).containsEntry("removedRelationCount", 1);
        verify(relations).removeById(30L);
    }

    @Test void manualGroupAndMalformedSkillSourcesSurviveAutomaticRevocation() {
        for (String info : List.of(SkillRelationSource.manual().toJson(),
            "{\"manual\":false,\"sourceGroupIds\":[40]}", "unknown legacy source")) {
            sources.rows.clear();
            sources.retain(1L, 20L, 10L, ResourceBindingSourceService.SYNC, 5L, 1L);
            relation.setRelResourceInfo(info);
            mutate(Set.of());
        }
        verify(relations, never()).removeById(any(java.io.Serializable.class));
    }

    @Test void cleanupOnlyNeverAddsASourceForNewUsers() {
        job.setAssociationMode("CLEANUP_ONLY");
        when(defaults.defaultEmployeesForUpdate(5L, 1L)).thenReturn(List.of(20L));
        sources.retain(1L, 20L, 10L, ResourceBindingSourceService.SYNC, 5L, 1L);
        mutate(Set.of(5L, 6L));
        assertThat(sources.activeUsers()).containsExactly(5L);
        verify(defaults, never()).defaultEmployees(6L, 1L);
    }

    @Test void cleanupAndRefreshNeverRecreateMissingPhysicalRelations() {
        when(relations.list(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(List.of());
        sources.retain(1L, 20L, 10L, ResourceBindingSourceService.SYNC, 5L, 1L);
        when(defaults.defaultEmployeesForUpdate(5L, 1L)).thenReturn(List.of(20L));
        job.setAssociationMode("CLEANUP_ONLY");
        mutate(Set.of(5L));
        job.setAssociationMode("NONE");
        mutate(Set.of());
        verify(relations, never()).save(any());
        assertThat(sources.activeUsers()).containsExactly(5L);
    }

    @Test void staleRevisionCannotMutateSourcesOrRelations() {
        resource.setThirdSyncRevision(3L);
        assertThatThrownBy(() -> mutate(Set.of())).isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(relations);
    }

    @Test void historicalToolRelationIsProtectedOnFirstTouch() {
        resource.setResourceBizType("TOOLKIT");
        mutate(Set.of());
        assertThat(sources.rows).extracting(ResourceBindingSource::getSourceType).containsExactly("LEGACY");
        verify(relations, never()).removeById(any(java.io.Serializable.class));
    }

    @Test void refreshTargetsArePersistedBeforeMutationsAndStaleRevisionCannotPublishThem() {
        com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(
            new org.apache.ibatis.builder.MapperBuilderAssistant(new org.apache.ibatis.session.Configuration(), "sync-test"),
            ResourceSyncJob.class);
        var transactions = mock(org.springframework.transaction.PlatformTransactionManager.class);
        when(transactions.getTransaction(any())).thenReturn(mock(org.springframework.transaction.TransactionStatus.class));
        var jobs = mock(com.iwhalecloud.byai.manager.mapper.resource.ResourceSyncJobMapper.class);
        when(jobs.update(isNull(), any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(1);
        ReflectionTestUtils.setField(service, "transactionManager", transactions);
        ReflectionTestUtils.setField(service, "jobs", jobs);
        job.setSyncJobId(100L); job.setRetryCount(0);
        Boolean persisted = ReflectionTestUtils.invokeMethod(service, "persistTargets", job, Set.of(20L));
        assertThat(persisted).isTrue();
        assertThat(job.getResultSummary()).contains("pendingEmployeeIds", "20");
        verify(transactions).commit(any());
        resource.setThirdSyncRevision(3L);
        assertThat((Boolean) ReflectionTestUtils.invokeMethod(service, "persistTargets", job, Set.of(21L))).isFalse();
        verify(jobs, times(1)).update(isNull(), any(com.baomidou.mybatisplus.core.conditions.Wrapper.class));
        assertThat(job.getResultSummary()).doesNotContain("21");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Integer> mutate(Set<Long> users) {
        return ReflectionTestUtils.invokeMethod(service, "reconcileEmployee", job, 20L, users);
    }

    static class MemorySources extends ResourceBindingSourceService {
        final List<ResourceBindingSource> rows = new ArrayList<>();
        @Override public List<ResourceBindingSource> sources(Long tenant, Long employee, Long resource) { return rows; }
        @Override public void retain(Long tenant, Long employee, Long resource, String type, Long user, Long revision) {
            ResourceBindingSource row = rows.stream().filter(source -> type.equals(source.getSourceType())
                && Objects.equals(user, source.getSourceUserId())).findFirst().orElse(null);
            if (row == null) { row = new ResourceBindingSource(); row.setSourceType(type); row.setSourceUserId(user); rows.add(row); }
            row.setStatusCd("A"); row.setSyncRevision(revision);
        }
        @Override public void revoke(ResourceBindingSource row) { row.setStatusCd("X"); }
        List<Long> activeUsers() { return rows.stream().filter(row -> "A".equals(row.getStatusCd()))
            .map(ResourceBindingSource::getSourceUserId).toList(); }
    }
}
