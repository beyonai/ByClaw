package com.iwhalecloud.byai.state.domain.groupchat.forward;

import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.port.ForwardSourceAuthorityReader;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import com.iwhalecloud.byai.manager.domain.customer.service.FilesService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.entity.users.Users;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import com.iwhalecloud.byai.manager.domain.tenant.TenantForwardSourceAuthorityReader;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipRow;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class GroupChatForwardSourceResolverTest {
    final ForwardActor actor = new ForwardActor(20, 10);
    final FilesService files = mock(FilesService.class);
    final UserService users = mock(UserService.class);
    final ForwardSourceAuthorityReader authority = mock(ForwardSourceAuthorityReader.class);
    final ForwardWorkspaceReader storage = mock(ForwardWorkspaceReader.class);
    final UploadedForwardSourceResolver resolver = new UploadedForwardSourceResolver(files, users, authority, storage, mock(ForwardUploadScope.class));
    SourceMessage source() {
        return new SourceMessage(31, 0, "file", new ForwardSpeaker(SpeakerType.USER, "21", "sender"), "2026-10-16T00:00:00Z",
            List.of(), Map.of("files", List.of(Map.of("fileId", "101", "filePath", "/by/.sessions/30/same.txt"))), Map.of(), List.of(),
            new SourceAuthority(actor, ForwardBackend.LEGACY, 30, 31, null, null, null, null, List.of()));
    }
    Files file() {
        Files file = new Files(); file.setFileId(101L); file.setChatId(30L); file.setCreateBy(22L);
        file.setFileName("same.txt"); file.setFileUrl("/commonFile/preview?style=minio&bucketName=byclaw-uploader&filePath=/.sessions/30/same.txt");
        file.setLength(4L); file.setFileSystemType("minio"); file.setContentType("text/plain");
        when(files.findById(101L)).thenReturn(file);
        Users user = new Users(); user.setUserId(22L); user.setUserCode("uploader"); when(users.findById(22L)).thenReturn(user);
        when(authority.requireUploadSession(actor, ForwardBackend.LEGACY, 30)).thenReturn(new SourceAuthority.UploadSession(actor, ForwardBackend.LEGACY, 30, 10));
        when(storage.storageType(file)).thenReturn("minio");
        return file;
    }
    @Test void doesNotReadForwardersSameNamedWorkspaceFile() {
        file(); var source = source(); var candidate = new ForwardSnapshotFactory().freeze(actor, 30, List.of(source)).candidates().getFirst();
        var result = resolver.resolve(actor, source, candidate);
        assertThat(result.identity().ownerId()).isEqualTo(22);
        assertThat(result.identity().path()).isEqualTo("/by/.sessions/30/same.txt");
        assertThat(result.fileName()).isEqualTo("same.txt");
        verify(storage, never()).open(any(), anyString());
    }
    @Test void fileRowWithoutTenantDoesNotAuthorizeCopy() {
        file(); when(authority.requireUploadSession(actor, ForwardBackend.LEGACY, 30)).thenThrow(new IllegalArgumentException("FORWARD_TENANT_UNRESOLVED"));
        var source = source(); var candidate = new ForwardSnapshotFactory().freeze(actor, 30, List.of(source)).candidates().getFirst();
        assertThatThrownBy(() -> resolver.resolve(actor, source, candidate)).hasMessage("FORWARD_TENANT_UNRESOLVED");
        verify(storage, never()).open(any(), anyString());
    }
    @Test void unknownOwnerOrForgedUrlNeverReadsStorage() {
        var file = file(); file.setCreateBy(99L);
        var source = source(); var candidate = new ForwardSnapshotFactory().freeze(actor, 30, List.of(source)).candidates().getFirst();
        assertThatThrownBy(() -> resolver.resolve(actor, source, candidate)).hasMessage("FORWARD_RESOURCE_UNRESOLVABLE");
        file.setCreateBy(22L); file.setFileUrl("https://attacker.invalid/same.txt");
        assertThatThrownBy(() -> resolver.resolve(actor, source, candidate)).hasMessage("FORWARD_RESOURCE_UNRESOLVABLE");
        file.setFileUrl("/commonFile/preview?style=minio&bucketName=byclaw-uploader&filePath=/.sessions/30/same.txt");
        users.findById(22L).setState("X");
        assertThatThrownBy(() -> resolver.resolve(actor,source,candidate)).hasMessage("FORWARD_RESOURCE_UNRESOLVABLE");
        verify(storage, never()).open(any(), anyString());
    }
    @Test void missingCloudFileIdStillCopies() {
        var datasets=mock(com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService.class);
        var cloud=new KnowledgeForwardSourceResolver(datasets);
        var published=Map.<String,Object>of("filePath","/public/report.txt","cloudResourceId","60","fileName","display name");
        var source=new SourceMessage(31,0,"published",new ForwardSpeaker(SpeakerType.AGENT,"23","agent"),"2026-10-16T00:00:00Z",List.of(),Map.of(),Map.of("files",List.of(published)),List.of(),
            new SourceAuthority(actor, ForwardBackend.LEGACY, 30, 31, 50L, null, "GROUP_CHAT", "TASK_RESULT", List.of(published)));
        when(datasets.forwardMetadata(actor,60,"/public/report.txt")).thenReturn(new com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService.ForwardDatasetFile(60,"cloud-code","/public/report.txt","report.txt","file",4L));
        var candidate=new ForwardSnapshotFactory().freeze(actor,30,List.of(source)).candidates().getFirst();
        var resolved=cloud.resolve(actor,source,candidate);
        assertThat(resolved.identity().ownerId()).isNull();
        assertThat(resolved.identity().scopeId()).isEqualTo("60");
        assertThat(resolved.fileName()).isEqualTo("report.txt");
    }
    @Test void missingHistoricalCloudBindingCannotUseCurrentProject() {
        var datasets=mock(com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService.class);
        var cloud=new KnowledgeForwardSourceResolver(datasets);
        var file=Map.<String,Object>of("filePath","/report.txt");
        var source=new SourceMessage(31,0,"published",new ForwardSpeaker(SpeakerType.AGENT,"23","agent"),"2026-10-16T00:00:00Z",List.of(),Map.of(),Map.of("files",List.of(file)),List.of(),
            new SourceAuthority(actor, ForwardBackend.LEGACY, 30, 31, 50L, null, "GROUP_CHAT", "TASK_RESULT", List.of(file)));
        var candidate=new ForwardSnapshotFactory().freeze(actor,30,List.of(source)).candidates().getFirst();
        assertThatThrownBy(() -> cloud.resolve(actor,source,candidate)).hasMessage("FORWARD_RESOURCE_UNRESOLVABLE");
        verifyNoInteractions(datasets);
    }

    @Test void untypedOpaqueFileCannotBeSilentlyDowngradedOrTreatedAsFileId() {
        var knowledge=mock(KnowledgeForwardSourceResolver.class);var workspace=mock(WorkspaceForwardSourceResolver.class);
        var classifier=new ForwardReferenceClassifier(knowledge,workspace);
        var source=new SourceMessage(31,0,"{{KG_DOC_FILE_opaque}}",new ForwardSpeaker(SpeakerType.USER,"21","author"),"2026-10-16T00:00:00Z",
            List.of(Map.of("id","KG_DOC_FILE_opaque","resourceId","101","resourceName","label")),Map.of(),Map.of(),List.of(),
            new SourceAuthority(actor, ForwardBackend.LEGACY, 30, 31, null, null, null, null, List.of()));
        var candidate=new ForwardSnapshotFactory().freeze(actor,30,List.of(source)).candidates().getFirst();
        assertThatThrownBy(() -> classifier.classify(actor,source,candidate)).hasMessage("FORWARD_RESOURCE_UNRESOLVABLE");
        verifyNoInteractions(files,knowledge,workspace);
    }

    @Test void forwardedSingleUsesOrdinaryUploadedFileAfterCurrentItemAuthorization() {
        var source=new SourceMessage(31,0,"single",new ForwardSpeaker(SpeakerType.USER,"21","forwarder"),"2026-10-16T00:00:00Z",List.of(),Map.of("files",List.of(Map.of("fileId","72"))),Map.of(),List.of(),
            new SourceAuthority(actor, ForwardBackend.LEGACY, 30, 31, null, "71", null, null, List.of()));
        var candidate=new ForwardSnapshotFactory().freeze(actor,30,List.of(source)).candidates().getFirst();
        var uploads=mock(UploadedForwardSourceResolver.class);
        var resolved=new ResolvedSource(new SourceIdentity(10,21L,"file","byclaw-forwarder","/by/.sessions/30/file.txt",null),"file.txt","text/plain",4L,"upload",source,candidate);
        when(authority.readMessage(actor,ForwardBackend.LEGACY,30,31)).thenReturn(source);when(uploads.resolve(actor,source,candidate)).thenReturn(resolved);
        var service=new AuthoritativeForwardSourceResolver(authority,uploads,mock(WorkspaceForwardSourceResolver.class),mock(KnowledgeForwardSourceResolver.class),mock(ForwardReferenceClassifier.class));
        service.open(actor,resolved);verify(uploads).open(actor,resolved);
    }


    @Test void uploadedResourceAndProjectScopeCannotBypassTenantChecks() {
        var projects=mock(com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService.class);
        var resources=mock(com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService.class);
        var auth=mock(com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService.class);
        var memberships=mock(com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService.class);
        var tenant=mock(com.iwhalecloud.byai.manager.domain.tenant.TenantProjectCloudAccessService.class);
        var scopes=new ForwardUploadScope(projects,resources,auth,memberships,tenant);
        var row=new Files();row.setProjectId(50L);
        var project=new com.iwhalecloud.byai.manager.entity.devloop.Project();project.setProjectId(50L);project.setEnterpriseId(11L);project.setCreateBy(actor.userId());
        when(projects.findById(50L)).thenReturn(project);
        assertThatThrownBy(() -> scopes.require(actor,row)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
        row.setProjectId(null);row.setDatasetId(60L);
        var resource=new com.iwhalecloud.byai.manager.entity.resource.SsResource();resource.setResourceId(60L);resource.setComAcctId(11L);when(resources.findById(60L)).thenReturn(resource);
        assertThatThrownBy(() -> scopes.require(actor,row)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
        verifyNoInteractions(auth,memberships,tenant);
    }

    /** Real primary/upload resolvers share the router; only owning SQL/transport boundaries are mocked. */
    final class BoundSourceFixture {
        final LegacyForwardSourceAuthorityReader legacy = mock(LegacyForwardSourceAuthorityReader.class);
        final TenantForwardSourceAuthorityReader node = mock(TenantForwardSourceAuthorityReader.class);
        final TenantAdminTenantMapper tenants = mock(TenantAdminTenantMapper.class);
        final TenantMembershipMapper memberships = mock(TenantMembershipMapper.class);
        final ForwardSourceAuthorityRouter router = new ForwardSourceAuthorityRouter(legacy, node, tenants, memberships);
        final ForwardSourceAuthorityReader owning;
        final ForwardSourceAuthorityReader other;
        final AuthoritativeForwardSourceResolver primary;
        final SourceMessage source;
        final SourceCandidate candidate;
        final ResolvedSource resolved;

        BoundSourceFixture(ForwardBackend backend) {
            file();
            owning = backend == ForwardBackend.LEGACY ? legacy : node;
            other = backend == ForwardBackend.LEGACY ? node : legacy;
            when(memberships.selectActiveMembership(20L, 10L)).thenReturn(new TenantMembershipRow());
            when(tenants.selectConfig(10L, "NODE_SANDBOX_RECORD_ID"))
                .thenReturn(backend == ForwardBackend.TENANT ? "configured" : null);
            var original = source();
            source = new SourceMessage(original.id(), original.timelineOrdinal(), original.content(), original.speaker(), original.createdAt(),
                original.resourceList(), original.relatedResources(), original.metadata(), original.mergedItems(),
                new SourceAuthority(actor, backend, 30, 31, null, null, null, null, List.of()));
            when(owning.readMessage(actor, 30, 31)).thenReturn(source);
            when(owning.requireUploadSession(actor, 30)).thenReturn(new SourceAuthority.UploadSession(actor, backend, 30, 10));
            var uploads = new UploadedForwardSourceResolver(files, users, router, storage, mock(ForwardUploadScope.class));
            primary = new AuthoritativeForwardSourceResolver(router, uploads, new WorkspaceForwardSourceResolver(files, uploads),
                mock(KnowledgeForwardSourceResolver.class), mock(ForwardReferenceClassifier.class));
            var authorized = router.readMessage(actor, 30, 31);
            candidate = new ForwardSnapshotFactory().freeze(actor, 30, List.of(authorized)).candidates().getFirst();
            resolved = primary.resolve(actor, authorized, candidate);
            // The trusted configuration changes only after initial source resolution.
            when(tenants.selectConfig(10L, "NODE_SANDBOX_RECORD_ID"))
                .thenReturn(backend == ForwardBackend.LEGACY ? "configured" : null);
            clearInvocations(legacy, node, tenants, memberships, storage);
        }
    }

    @ParameterizedTest @EnumSource(ForwardBackend.class)
    void reopenKeepsOwningBackendAfterConfigurationChange(ForwardBackend backend) throws Exception {
        var fixture = new BoundSourceFixture(backend);
        var read = new ForwardSourceRead(new java.io.ByteArrayInputStream(new byte[] {7}),
            mock(com.iwhalecloud.byai.common.storage.model.FileMetadata.class));
        when(storage.open(any(), eq("uploader"))).thenReturn(read);
        assertThatCode(() -> {
            try (var opened = fixture.primary.open(actor, fixture.resolved)) {
                assertThat(opened.stream().read()).isEqualTo(7);
            }
        }).doesNotThrowAnyException();
        verify(fixture.owning).readMessage(actor, 30, 31);
        verify(fixture.owning).requireUploadSession(actor, 30);
        verifyNoInteractions(fixture.other, fixture.tenants);
    }

    @ParameterizedTest @EnumSource(ForwardBackend.class)
    void reopenFailureNeverProbesNewlyConfiguredBackend(ForwardBackend backend) {
        var fixture = new BoundSourceFixture(backend);
        when(fixture.owning.readMessage(actor, 30, 31)).thenThrow(new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE"));
        assertThatThrownBy(() -> fixture.primary.open(actor, fixture.resolved)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
        verify(fixture.owning).readMessage(actor, 30, 31);
        verifyNoInteractions(fixture.other, fixture.tenants, storage);
    }

    @ParameterizedTest @EnumSource(ForwardBackend.class)
    void uploadResolutionKeepsOwningBackendAfterConfigurationChange(ForwardBackend backend) {
        var fixture = new BoundSourceFixture(backend);
        assertThatCode(() -> assertThat(fixture.primary.resolve(actor, fixture.source, fixture.candidate).identity().ownerId()).isEqualTo(22))
            .doesNotThrowAnyException();
        verify(fixture.owning).requireUploadSession(actor, 30);
        verifyNoInteractions(fixture.other, fixture.tenants);
        clearInvocations(fixture.owning, storage);
        when(fixture.owning.requireUploadSession(actor, 30)).thenThrow(new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE"));
        assertThatThrownBy(() -> fixture.primary.resolve(actor, fixture.source, fixture.candidate)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
        verify(fixture.owning).requireUploadSession(actor, 30);
        verifyNoInteractions(fixture.other, fixture.tenants, storage);
    }

    @ParameterizedTest @EnumSource(ForwardBackend.class)
    void boundReadsStillCheckCurrentPlatformMembership(ForwardBackend backend) {
        var fixture = new BoundSourceFixture(backend);
        when(fixture.memberships.selectActiveMembership(20L, 10L)).thenReturn(null);
        assertThatThrownBy(() -> fixture.primary.open(actor, fixture.resolved)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
        assertThatThrownBy(() -> fixture.primary.resolve(actor, fixture.source, fixture.candidate)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
        verifyNoInteractions(fixture.legacy, fixture.node, storage);
    }

}
