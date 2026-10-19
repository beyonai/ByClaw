package com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.state.domain.groupchat.forward.port.ForwardSourceAuthorityReader;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardEligibility;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.*;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTaskPublication;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.domain.session.service.*;
import org.springframework.stereotype.Component;
import java.util.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.ForwardSourceFacts.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.ForwardSourceProjection.*;

/** Shared-store adapter. It participates in the caller's transaction and performs no file I/O. */
@Component
public class LegacyForwardSourceAuthorityReader implements ForwardSourceAuthorityReader {
    private final SessionService sessions; private final SessionMemberService members; private final ByaiMessageMapper messages;
    private final ByaiGroupChatTaskMapper tasks; private final ByaiGroupChatTaskPublicationMapper publications;
    private final ByaiGroupChatPendingPublicationMapper pending;
    private final ByaiGroupChatForwardSourceMapper sources; private final ByaiGroupChatForwardMapper forwards;
    public LegacyForwardSourceAuthorityReader(SessionService sessions, SessionMemberService members, ByaiMessageMapper messages,
            ByaiGroupChatTaskMapper tasks, ByaiGroupChatTaskPublicationMapper publications, ByaiGroupChatPendingPublicationMapper pending, ByaiGroupChatForwardSourceMapper sources, ByaiGroupChatForwardMapper forwards) {
        this.sessions=sessions;this.members=members;this.messages=messages;this.tasks=tasks;this.publications=publications;this.pending=pending;this.sources=sources;this.forwards=forwards;
    }
    private ByaiSession session(ForwardActor actor, long id, boolean group) { return session(actor,id,group,new HashSet<>()); }
    private ByaiSession session(ForwardActor actor, long id, boolean group, Set<Long> visited) {
        if (!visited.add(id) || visited.size()>32) throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        var session = sessions.findById(id);
        var member = members.findSessionMember(id, "USER", actor.userId());
        // Shared historical membership rows may have a null or old account field; the owning session tenant is authoritative.
        boolean authorizedMember = member != null;
        if (group) ForwardEligibility.requireSource(actor, session == null ? null : new ForwardEligibility.GroupIdentity(id, session.getEnterpriseId(), session.getSessionType(), session.getState()), authorizedMember);
        if (session == null || session.getEnterpriseId() == null) throw new IllegalArgumentException("FORWARD_TENANT_UNRESOLVED");
        if (!Objects.equals(session.getEnterpriseId(), actor.enterpriseId()) || ("hs_as".equals(session.getSessionType()) ? !authorizedMember : !Objects.equals(session.getCreatorId(), actor.userId()))
            || session.getState() != null && Set.of("GROUP_DISSOLVED","CLOSED","GROUP_CHAT_ROUTING","GROUP_CHAT_DISPATCH","GROUP_TASK","GROUP_TASK_CANDIDATE").contains(session.getState())
            || tasks.selectById(id) != null) throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        if (!"hs_as".equals(session.getSessionType()) && session.getParentSessionId()!=null) session(actor,session.getParentSessionId(),false,visited);
        return session;
    }
    @Override public SourceAuthority.UploadSession requireUploadSession(ForwardActor actor, long sessionId) {
        session(actor, sessionId, false);
        return new SourceAuthority.UploadSession(actor, ForwardBackend.LEGACY, sessionId, actor.enterpriseId());
    }
    @Override public SourceMessage readMessage(ForwardActor actor, long sourceId, long selectedId) {
        var session = session(actor, sourceId, true); var message = messages.selectByMessageId(selectedId);
        if (message == null || !Objects.equals(message.getSessionId(), sourceId) || !Objects.equals(message.getEnterpriseId(), actor.enterpriseId())
            || message.isRecalled() || message.getArchivedAt() != null || !Set.of(1,2).contains(message.getUsage())) throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        var metadata = map(message.getMetadata()); var related = map(message.getRelatedResources());
        List<Map<String,Object>> publicationFiles = List.of();
        if ("GROUP_CHAT".equals(metadata.get("scene")) && "TASK_RESULT".equals(metadata.get("kind"))) {
            var publication = publications.selectOne(new LambdaQueryWrapper<ByaiGroupChatTaskPublication>()
                .eq(ByaiGroupChatTaskPublication::getTaskSessionId,id(metadata.get("taskId")))
                .eq(ByaiGroupChatTaskPublication::getGroupSessionId,sourceId).eq(ByaiGroupChatTaskPublication::getMessageId,selectedId));
            if (publication == null) throw unresolved();
            publicationFiles = ForwardSourceProjection.publicationFiles(publication, publication.getPendingPublicationId()==null?null:pending.selectById(publication.getTaskSessionId()));
        }
        var authority = new SourceAuthority(actor, ForwardBackend.LEGACY, sourceId, selectedId, session.getProjectId(), null, text(metadata.get("scene")), text(metadata.get("kind")), publicationFiles);
        List<SourceMessage> children = new ArrayList<>();
        var items = sources.items(actor.enterpriseId(), sourceId, selectedId);
        if (items.size() > 100) throw unresolved();
        for (var item : items) {
            var target = forwards.target(actor.enterpriseId(),item.getTargetId());
            if (target == null || !"SUCCEEDED".equals(target.getState()) || !Objects.equals(target.getTargetSessionId(),sourceId)
                || !com.alibaba.fastjson.JSON.parseArray(target.getMessageIdsJson(),String.class).contains(Long.toString(selectedId))) throw unresolved();
            var rawAttachments = com.alibaba.fastjson.JSON.parseArray(item.getAttachmentsJson());
            if(rawAttachments==null || rawAttachments.size()>100)throw unresolved();
            var files=entries(rawAttachments);
            var common=files.stream().filter(file -> text(file.get("cloudResourceId"))==null).toList();
            var cloud=files.stream().filter(file -> text(file.get("cloudResourceId"))!=null).toList();
            var innerAuthority = new SourceAuthority(actor, ForwardBackend.LEGACY, sourceId, selectedId, session.getProjectId(), item.getItemId().toString(), "GROUP_CHAT", "FORWARD_SINGLE", cloud);
            children.add(new SourceMessage(item.getSourceMessageId(),item.getOrdinal(),item.getContent(),speaker(item.getSpeakerJson()),item.getSourceCreatedAt().toString(),
                references(item.getReferencesJson()),Map.of("files",common),Map.of("files",cloud),List.of(),innerAuthority));
        }
        var result = new SourceMessage(selectedId,0,Objects.requireNonNullElse(message.getMessageContent(),""),
            new ForwardSpeaker(message.getUsage()==1?SpeakerType.USER:SpeakerType.AGENT,message.getCreatorId().toString(),Objects.requireNonNullElse(message.getCreatorName(),"Unknown")),
            message.getCreateTime().toInstant().toString(),references(related.getOrDefault("resourceList",metadata.get("resourceList"))),Map.of("files",entries(related.get("files"))),Map.of("files",entries(metadata.get("files"))),children,authority);
        boolean forwarded = "GROUP_CHAT".equals(metadata.get("scene")) && Set.of("FORWARD_SINGLE","FORWARD_MERGED").contains(Objects.toString(metadata.get("kind"),""));
        if (forwarded && children.isEmpty() || !forwarded && !children.isEmpty()) throw unresolved();
        if (forwarded && "FORWARD_SINGLE".equals(metadata.get("kind"))) {
            if (children.size()!=1 || !result.content().equals(children.getFirst().content())) throw unresolved();
            var item=children.getFirst();
            // An ordinary forward is a current message by its forwarder; merged cards alone preserve inner authors/time.
            result=new SourceMessage(selectedId,0,result.content(),result.speaker(),result.createdAt(),item.resourceList(),item.relatedResources(),item.metadata(),List.of(),item.authority());
        }
        return result;
    }
    @Override public SourceMessage readMessage(ForwardActor actor, ForwardBackend backend, long group, long message) {
        if (backend != ForwardBackend.LEGACY) throw new IllegalArgumentException("FORWARD_RESOURCE_UNRESOLVABLE");
        return readMessage(actor, group, message);
    }

    @Override public SourceAuthority.UploadSession requireUploadSession(ForwardActor actor, ForwardBackend backend, long session) {
        if (backend != ForwardBackend.LEGACY) throw new IllegalArgumentException("FORWARD_RESOURCE_UNRESOLVABLE");
        return requireUploadSession(actor, session);
    }

}
