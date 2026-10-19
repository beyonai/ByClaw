package com.iwhalecloud.byai.state.domain.groupchat.forward;

import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.manager.domain.tenant.*;
import com.iwhalecloud.byai.manager.mapper.tenant.*;
import com.iwhalecloud.byai.manager.mapper.groupchat.*;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.entity.session.*;
import com.iwhalecloud.byai.state.domain.session.service.*;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.SourceAuthority;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class ForwardSourceAuthorityReaderTest {
    @Test void legacyReadsActualTenantAndUploaderIsNotAssumedFromMessageAuthor() {
        var sessions=mock(SessionService.class);var members=mock(SessionMemberService.class);var messages=mock(ByaiMessageMapper.class);
        var tasks=mock(ByaiGroupChatTaskMapper.class);var publications=mock(ByaiGroupChatTaskPublicationMapper.class);
        var sources=mock(ByaiGroupChatForwardSourceMapper.class);var forwards=mock(ByaiGroupChatForwardMapper.class);
        var reader=new LegacyForwardSourceAuthorityReader(sessions,members,messages,tasks,publications,mock(ByaiGroupChatPendingPublicationMapper.class),sources,forwards);
        var group=new ByaiSession();group.setSessionId(30L);group.setEnterpriseId(1L);group.setSessionType("hs_as");group.setCreatorId(99L);
        var member=new ByaiSessionMember();member.setComAcctId(1L);
        when(sessions.findById(30L)).thenReturn(group);when(members.findSessionMember(30L,"USER",20L)).thenReturn(member);
        var message=new ByaiMessage();message.setMessageId(31L);message.setSessionId(30L);message.setEnterpriseId(1L);message.setUsage(1);message.setCreatorId(21L);message.setCreatorName("author");message.setCreateTime(new Date());message.setMessageContent("body");
        when(messages.selectByMessageId(31L)).thenReturn(message);when(sources.items(1,30,31)).thenReturn(List.of());
        var source=reader.readMessage(new ForwardActor(20,1),30,31);
        assertThat(source.authority().sourceSessionId()).isEqualTo(30);assertThat(source.speaker().id()).isEqualTo("21");
        message.setEnterpriseId(2L);
        assertThatThrownBy(() -> reader.readMessage(new ForwardActor(20,1),30,31)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
    }
    @Test void nodeFailureNeverReadsSharedMessageStore() {
        var legacy=mock(LegacyForwardSourceAuthorityReader.class);var node=mock(TenantForwardSourceAuthorityReader.class);
        var tenants=mock(TenantAdminTenantMapper.class);var memberships=mock(TenantMembershipMapper.class);
        var reader=new ForwardSourceAuthorityRouter(legacy,node,tenants,memberships);
        // Default tenant routing still uses the actual configured backend; tenant 1 never means unrestricted.
        when(tenants.selectConfig(1L,"NODE_SANDBOX_RECORD_ID")).thenReturn("configured");
        var actor=new ForwardActor(20,1);when(node.readMessage(actor,30,31)).thenThrow(new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE"));
        assertThatThrownBy(() -> reader.readMessage(actor,30,31)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
        verifyNoInteractions(legacy);
    }
    @Test void historicalCheckpointRequiresMatchingPublicationGenerationAndPath() {
        var publication=new com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTaskPublication();
        publication.setTaskSessionId(40L);publication.setPendingPublicationId(44L);publication.setFilesJson("[{\"filePath\":\"/published.txt\"}]");
        var pending=new com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatPendingPublication();
        pending.setTaskSessionId(40L);pending.setPendingPublicationId(44L);pending.setCloudResourceId(60L);
        pending.setUploadedFilesJson("{\"/by/private.txt\":[{\"filePath\":\"/published.txt\"}]}");
        assertThat(ForwardSourceProjection.publicationFiles(publication,pending).getFirst()).containsEntry("cloudResourceId","60");
        pending.setPendingPublicationId(45L);
        assertThat(ForwardSourceProjection.publicationFiles(publication,pending).getFirst()).doesNotContainKey("cloudResourceId");
    }

    @ParameterizedTest @EnumSource(ForwardBackend.class)
    void boundRouterRejectsMismatchedMessageAuthority(ForwardBackend backend) {
        var legacy = mock(LegacyForwardSourceAuthorityReader.class);
        var node = mock(TenantForwardSourceAuthorityReader.class);
        var tenants = mock(TenantAdminTenantMapper.class);
        var router = new ForwardSourceAuthorityRouter(legacy, node, tenants, mock(TenantMembershipMapper.class));
        com.iwhalecloud.byai.state.domain.groupchat.forward.port.ForwardSourceAuthorityReader owner = backend == ForwardBackend.LEGACY ? legacy : node;
        com.iwhalecloud.byai.state.domain.groupchat.forward.port.ForwardSourceAuthorityReader other = backend == ForwardBackend.LEGACY ? node : legacy;
        var actor = new ForwardActor(20, 1);
        var opposite = backend == ForwardBackend.LEGACY ? ForwardBackend.TENANT : ForwardBackend.LEGACY;
        for (var evidence : List.of(
            new SourceAuthority(new ForwardActor(21, 1), backend, 30, 31, null, null, null, null, List.of()),
            new SourceAuthority(new ForwardActor(20, 2), backend, 30, 31, null, null, null, null, List.of()),
            new SourceAuthority(actor, backend, 32, 31, null, null, null, null, List.of()),
            new SourceAuthority(actor, backend, 30, 32, null, null, null, null, List.of()),
            new SourceAuthority(actor, opposite, 30, 31, null, null, null, null, List.of()))) {
            when(owner.readMessage(actor, 30, 31)).thenReturn(new SourceMessage(31, 0, "body",
                new ForwardSpeaker(SpeakerType.USER, "20", "speaker"), "2026-10-16T00:00:00Z",
                List.of(), Map.of(), Map.of(), List.of(), evidence));
            assertThatThrownBy(() -> router.readMessage(actor, backend, 30, 31)).hasMessage("FORWARD_RESOURCE_UNRESOLVABLE");
        }
        verifyNoInteractions(other, tenants);
    }

    @ParameterizedTest @EnumSource(ForwardBackend.class)
    void boundRouterRejectsMismatchedUploadAuthority(ForwardBackend backend) {
        var legacy = mock(LegacyForwardSourceAuthorityReader.class);
        var node = mock(TenantForwardSourceAuthorityReader.class);
        var tenants = mock(TenantAdminTenantMapper.class);
        var router = new ForwardSourceAuthorityRouter(legacy, node, tenants, mock(TenantMembershipMapper.class));
        com.iwhalecloud.byai.state.domain.groupchat.forward.port.ForwardSourceAuthorityReader owner = backend == ForwardBackend.LEGACY ? legacy : node;
        com.iwhalecloud.byai.state.domain.groupchat.forward.port.ForwardSourceAuthorityReader other = backend == ForwardBackend.LEGACY ? node : legacy;
        var actor = new ForwardActor(20, 1);
        var opposite = backend == ForwardBackend.LEGACY ? ForwardBackend.TENANT : ForwardBackend.LEGACY;
        for (var evidence : List.of(
            new SourceAuthority.UploadSession(new ForwardActor(21, 1), backend, 30, 1),
            new SourceAuthority.UploadSession(new ForwardActor(20, 2), backend, 30, 1),
            new SourceAuthority.UploadSession(actor, backend, 30, 2),
            new SourceAuthority.UploadSession(actor, backend, 32, 1),
            new SourceAuthority.UploadSession(actor, opposite, 30, 1))) {
            when(owner.requireUploadSession(actor, 30)).thenReturn(evidence);
            assertThatThrownBy(() -> router.requireUploadSession(actor, backend, 30)).hasMessage("FORWARD_RESOURCE_UNRESOLVABLE");
        }
        verifyNoInteractions(other, tenants);
    }

}
