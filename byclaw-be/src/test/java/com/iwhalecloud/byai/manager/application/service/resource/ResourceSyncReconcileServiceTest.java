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

class ResourceSyncReconcileServiceTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {
    private ResourceSyncReconcileService service;
    private SsResourceRelDetailService relations;
    private ResourceSyncScopeMapper assistants;
    private MemorySources sources;
    private ResourceSyncJob job;
    private SsResource resource;
    private SsResourceRelDetail relation;
    private SsResource employee;

    @BeforeEach void setup() {
        LoginInfo login = new LoginInfo(); login.setUserId(9L); login.setEnterpriseId(1L);
        CurrentUserHolder.setLoginInfo(login);
        service = new ResourceSyncReconcileService();
        relations = mock(SsResourceRelDetailService.class);
        assistants = mock(ResourceSyncScopeMapper.class);
        when(assistants.activeTenantUsers(any(), any())).thenAnswer(call -> call.getArgument(0));
        sources = new MemorySources();
        var resources = mock(SsResourceService.class);
        var auth = mock(AuthApplicationService.class);
        when(auth.hasResourceUsePermission(any(), any())).thenReturn(true);
        var extensions = mock(SsResExtDigEmployeeService.class);
        SsResExtDigEmployee extension = new SsResExtDigEmployee(); extension.setAgentType("001");
        when(extensions.findById(20L)).thenReturn(extension);
        resource = new SsResource(); resource.setResourceId(10L); resource.setResourceBizType("SKILL");
        resource.setResourceStatus(2); resource.setOwnerType("enterprise"); resource.setComAcctId(1L); resource.setThirdSyncRevision(2L);
        employee = new SsResource(); employee.setResourceId(20L); employee.setResourceBizType("DIG_EMPLOYEE");
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
        ReflectionTestUtils.setField(service, "scopeMapper", assistants);
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
        when(assistants.personalAssistants(6L, 1L)).thenReturn(List.of(20L));
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
        when(assistants.personalAssistants(5L, 1L)).thenReturn(List.of(20L));
        sources.retain(1L, 20L, 10L, ResourceBindingSourceService.SYNC, 5L, 1L);
        mutate(Set.of(5L, 6L));
        assertThat(sources.activeUsers()).containsExactly(5L);
        verify(assistants, never()).personalAssistants(6L, 1L);
    }

    @Test void activeTenantMemberCanRetainAutomaticBinding() {
        when(assistants.personalAssistants(5L, 1L)).thenReturn(List.of(20L));
        mutate(Set.of(5L));
        assertThat(sources.activeUsers()).containsExactly(5L);
        verify(assistants).activeTenantUsers(List.of(5L), 1L);
        verify(relations, never()).removeById(any(java.io.Serializable.class));
    }

    @Test void inactiveUserCannotKeepAnAutomaticBinding() {
        sources.retain(1L, 20L, 10L, ResourceBindingSourceService.SYNC, 5L, 1L);
        when(assistants.activeTenantUsers(List.of(5L), 1L)).thenReturn(List.of());
        mutate(Set.of(5L));
        assertThat(sources.activeUsers()).isEmpty();
        verify(assistants, never()).personalAssistants(any(), eq(1L));
        verify(relations).removeById(30L);
    }

    @Test void ambiguousPersonalAssistantsNeverCreateAutomaticBindings() {
        when(assistants.personalAssistants(5L, 1L)).thenReturn(List.of(20L, 21L));
        mutate(Set.of(5L));
        assertThat(sources.activeUsers()).isEmpty();
        verify(relations, never()).save(any());
    }

    @Test void changedPersonalAssistantMappingCannotRetainTheOldAutomaticBinding() {
        sources.retain(1L, 20L, 10L, ResourceBindingSourceService.SYNC, 5L, 1L);
        when(assistants.personalAssistants(5L, 1L)).thenReturn(List.of(21L));
        mutate(Set.of(5L));
        assertThat(sources.activeUsers()).isEmpty();
        verify(relations).removeById(30L);
    }

    @Test void cleanupAndRefreshNeverRecreateMissingPhysicalRelations() {
        when(relations.list(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(List.of());
        sources.retain(1L, 20L, 10L, ResourceBindingSourceService.SYNC, 5L, 1L);
        when(assistants.personalAssistants(5L, 1L)).thenReturn(List.of(20L));
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

    @Test void crossTenantEmployeeCannotReceiveSynchronizedResources() {
        employee.setComAcctId(3L);
        assertThatThrownBy(() -> mutate(Set.of(5L))).isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(relations);
    }

    @Test void missingTenantInvalidatesAResourceRevision() {
        resource.setComAcctId(null);
        assertThatThrownBy(() -> mutate(Set.of(5L))).isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(relations);
    }

    @Test void manualToolSourceSurvivesAutomaticCleanup() {
        resource.setResourceBizType("TOOLKIT");
        sources.retain(1L, 20L, 10L, "MANUAL", null, null);
        sources.retain(1L, 20L, 10L, ResourceBindingSourceService.SYNC, 5L, 1L);
        mutate(Set.of());
        assertThat(sources.rows).filteredOn(source -> "A".equals(source.getStatusCd()))
            .extracting(ResourceBindingSource::getSourceType).containsExactly("MANUAL");
        verify(relations, never()).removeById(any(java.io.Serializable.class));
    }

    @Test void authorizedPersonalAssistantReceivesTheSynchronizedSkill() {
        when(assistants.personalAssistants(5L, 1L)).thenReturn(List.of(20L));
        employee.setOwnerType("personal");
        mutate(Set.of(5L));
        assertThat(sources.activeUsers()).containsExactly(5L);
    }

    @Test void unauthorizedPersonalAssistantRemainsIneligible() {
        when(assistants.personalAssistants(5L, 1L)).thenReturn(List.of(20L));
        employee.setOwnerType("personal");
        var auth = (AuthApplicationService) ReflectionTestUtils.getField(service, "auth");
        when(auth.hasResourceUsePermission(employee, 5L)).thenReturn(false);
        mutate(Set.of(5L));
        assertThat(sources.activeUsers()).isEmpty();
    }

    @Test void superAssistantsRemainIneligible() {
        when(assistants.personalAssistants(5L, 1L)).thenReturn(List.of(20L));
        employee.setOwnerType("personal"); employee.setWorkerAgentType("BY_SUPER");
        mutate(Set.of(5L));
        assertThat(sources.activeUsers()).isEmpty();
        verify(relations, never()).save(any());
    }

    @Test void historicalToolRelationIsProtectedOnFirstTouch() {
        resource.setResourceBizType("TOOLKIT");
        mutate(Set.of());
        assertThat(sources.rows).extracting(ResourceBindingSource::getSourceType).containsExactly("LEGACY");
        verify(relations, never()).removeById(any(java.io.Serializable.class));
    }

    @Test void fullSkillReconciliationPublishesAssociatesAndRefreshesWithinTenant() {
        prepareFullReconciliation();
        when(assistants.personalAssistantsBatch(List.of(5L), 1L)).thenReturn(List.of(new ResourceSyncScopeMapper.UserAssistantRow(5L, 20L)));
        when(assistants.personalAssistants(5L, 1L)).thenReturn(List.of(20L));
        service.reconcile(job);
        assertThat(job.getStatus()).isEqualTo("COMPLETED");
        assertThat(sources.activeUsers()).containsExactly(5L);
        var created = org.mockito.ArgumentCaptor.forClass(SsResourceRelDetail.class);
        verify(relations).save(created.capture());
        assertThat(created.getValue().getResourceId()).isEqualTo(20L);
        assertThat(created.getValue().getRelResourceId()).isEqualTo(10L);
        assertThat(created.getValue().getRelTypeName()).isEqualTo("DIG_EMPLOYEE_SKILL");
        var skills = (com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService)
            ReflectionTestUtils.getField(service, "skills");
        verify(skills).publishEnterpriseSyncArtifacts(10L);
        var runtime = (com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeRuntimeRefreshService)
            ReflectionTestUtils.getField(service, "runtime");
        verify(runtime).refreshForResourceSync(20L);
    }

    @Test void fullReconciliationSkipsAmbiguousPersonalAssistantsBeforeChangingAnyEmployee() {
        prepareFullReconciliation();
        when(assistants.personalAssistantsBatch(List.of(5L), 1L)).thenReturn(List.of(
            new ResourceSyncScopeMapper.UserAssistantRow(5L, 20L), new ResourceSyncScopeMapper.UserAssistantRow(5L, 21L)));
        service.reconcile(job);
        assertThat(job.getStatus()).isEqualTo("COMPLETED");
        assertThat(job.getResultSummary()).contains("AMBIGUOUS_PERSONAL_ASSISTANT");
        assertThat(sources.activeUsers()).isEmpty();
        verify(relations, never()).save(any());
        verify(assistants, never()).personalAssistants(any(), eq(1L));
    }

    @Test void fullReconciliationSkipsMissingPersonalAssistants() {
        prepareFullReconciliation();
        service.reconcile(job);
        assertThat(job.getStatus()).isEqualTo("COMPLETED");
        assertThat(job.getResultSummary()).contains("NO_PERSONAL_ASSISTANT");
        assertThat(sources.activeUsers()).isEmpty();
        verify(relations, never()).save(any());
        verify(assistants, never()).personalAssistants(any(), eq(1L));
    }

    @Test void fullReconciliationMovesAutomaticBindingFromOldDefaultToPersonalAssistant() {
        prepareFullReconciliation();
        when(assistants.personalAssistantsBatch(List.of(5L), 1L)).thenReturn(List.of(
            new ResourceSyncScopeMapper.UserAssistantRow(5L, 20L)));
        when(assistants.personalAssistants(5L, 1L)).thenReturn(List.of(20L));
        sources.retain(1L, 21L, 10L, ResourceBindingSourceService.SYNC, 5L, 1L);
        SsResource oldDefault = new SsResource();
        oldDefault.setResourceId(21L); oldDefault.setComAcctId(1L);
        var resources = (SsResourceService) ReflectionTestUtils.getField(service, "resources");
        when(resources.findByIdForUpdate(21L)).thenReturn(oldDefault);
        when(resources.findById(21L)).thenReturn(oldDefault);
        SsResourceRelDetail oldRelation = new SsResourceRelDetail();
        oldRelation.setResourceRelDetailId(31L);
        oldRelation.setResourceId(21L);
        oldRelation.setRelResourceId(10L);
        oldRelation.setRelResourceInfo(SkillRelationSource.parse(
            "{\"manual\":false,\"sourceGroupIds\":[]}").toJson());
        when(relations.list(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class)))
            .thenReturn(List.of(), List.of(oldRelation));

        service.reconcile(job);

        assertThat(job.getStatus()).isEqualTo("COMPLETED");
        assertThat(sources.sourcesForSynchronization(20L, 10L)).singleElement()
            .satisfies(source -> assertThat(source.getStatusCd()).isEqualTo("A"));
        assertThat(sources.sourcesForSynchronization(21L, 10L)).singleElement()
            .satisfies(source -> assertThat(source.getStatusCd()).isEqualTo("X"));
        var created = org.mockito.ArgumentCaptor.forClass(SsResourceRelDetail.class);
        verify(relations).save(created.capture());
        assertThat(created.getValue().getResourceId()).isEqualTo(20L);
        verify(relations).removeById(31L);
        var runtime = (com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeRuntimeRefreshService)
            ReflectionTestUtils.getField(service, "runtime");
        verify(runtime).refreshForResourceSync(20L);
        verify(runtime).refreshForResourceSync(21L);
    }

    private void prepareFullReconciliation() {
        com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(
            new org.apache.ibatis.builder.MapperBuilderAssistant(new org.apache.ibatis.session.Configuration(), "sync-test"),
            ResourceSyncJob.class);
        var resources = (SsResourceService) ReflectionTestUtils.getField(service, "resources");
        when(resources.findById(10L)).thenReturn(resource);
        when(resources.findById(20L)).thenReturn(employee);
        var sync = mock(EnterpriseResourceSyncService.class);
        when(sync.expand(any())).thenReturn(Set.of(5L));
        when(sync.activeTenantUsers(any(), any())).thenReturn(Set.of(5L));
        ReflectionTestUtils.setField(service, "sync", sync);
        var transactions = mock(org.springframework.transaction.PlatformTransactionManager.class);
        when(transactions.getTransaction(any())).thenAnswer(call -> mock(org.springframework.transaction.TransactionStatus.class));
        ReflectionTestUtils.setField(service, "transactionManager", transactions);
        var jobs = mock(com.iwhalecloud.byai.manager.mapper.resource.ResourceSyncJobMapper.class);
        when(jobs.update(isNull(), any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(1);
        ReflectionTestUtils.setField(service, "jobs", jobs);
        ReflectionTestUtils.setField(service, "skills", mock(
            com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService.class));
        ReflectionTestUtils.setField(service, "runtime", mock(
            com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeRuntimeRefreshService.class));
        when(relations.list(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(List.of());
        when(relations.save(any())).thenReturn(true);
        job.setSyncJobId(100L); job.setRetryCount(0); job.setStatus("RUNNING");
        job.setAuthScope("{\"userIds\":[\"5\"],\"orgIds\":[],\"postIds\":[]}");
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
        @Override public List<ResourceBindingSource> sources(Long tenant, Long employee, Long resource) {
            return rows.stream().filter(row -> Objects.equals(tenant, row.getComAcctId())
                && Objects.equals(employee, row.getDigitalEmployeeId()) && Objects.equals(resource, row.getResourceId())).toList();
        }
        @Override public List<ResourceBindingSource> automaticSources(Long tenant, Long resource) {
            return rows.stream().filter(row -> Objects.equals(tenant, row.getComAcctId())
                && Objects.equals(resource, row.getResourceId()) && SYNC.equals(row.getSourceType()) && "A".equals(row.getStatusCd())).toList();
        }
        public List<ResourceBindingSource> sourcesForSynchronization(Long employee, Long resource) {
            return rows.stream().filter(row -> Objects.equals(employee, row.getDigitalEmployeeId())
                && Objects.equals(resource, row.getResourceId())).toList();
        }
        public List<ResourceBindingSource> automaticSourcesForSynchronization(Long resource) {
            return rows.stream().filter(row -> Objects.equals(resource, row.getResourceId())
                && SYNC.equals(row.getSourceType()) && "A".equals(row.getStatusCd())).toList();
        }
        public void retainForSynchronization(Long tenant, Long employee, Long resource, String type, Long user, Long revision) {
            retain(tenant, employee, resource, type, user, revision);
        }
        @Override public void retain(Long tenant, Long employee, Long resource, String type, Long user, Long revision) {
            ResourceBindingSource row = sourcesForSynchronization(employee, resource).stream()
                .filter(source -> type.equals(source.getSourceType())
                && Objects.equals(user, source.getSourceUserId())).findFirst().orElse(null);
            if (row == null) {
                row = new ResourceBindingSource();
                row.setComAcctId(tenant); row.setDigitalEmployeeId(employee); row.setResourceId(resource);
                row.setSourceType(type); row.setSourceUserId(user); rows.add(row);
            }
            row.setStatusCd("A"); row.setSyncRevision(revision);
        }
        @Override public void revoke(ResourceBindingSource row) { row.setStatusCd("X"); }
        List<Long> activeUsers() { return rows.stream().filter(row -> "A".equals(row.getStatusCd()))
            .map(ResourceBindingSource::getSourceUserId).toList(); }
    }
}
