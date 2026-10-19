package com.iwhalecloud.byai.manager.domain.tenant;

import com.iwhalecloud.byai.state.domain.groupchat.forward.port.ForwardSourceAuthorityReader;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.SourceAuthority;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.ForwardSourceProjection;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper;
import org.springframework.stereotype.Component;

/** Tenant message/session evidence never falls back to shared message or session tables. */
@Component
public class TenantForwardSourceAuthorityReader implements ForwardSourceAuthorityReader {
    private final TenantGroupData data; private final TenantMembershipMapper memberships;
    public TenantForwardSourceAuthorityReader(TenantGroupData data, TenantMembershipMapper memberships) {this.data=data;this.memberships=memberships;}
    private TenantRequestContext context(ForwardActor actor) {
        var member=memberships.selectActiveMembership(actor.userId(),actor.enterpriseId());
        if(member==null) throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        return new TenantRequestContext(actor.userId(),actor.enterpriseId(),member.getRole());
    }
    @Override public SourceMessage readMessage(ForwardActor actor,long group,long message) {
        var source=ForwardSourceProjection.fromNode(data.read(context(actor),"group-chats/"+group+"/forward-sources/"+message),actor);
        if(source.id()!=message || source.authority().sourceSessionId()!=group || source.authority().selectedMessageId()!=message) throw new IllegalArgumentException("FORWARD_RESOURCE_UNRESOLVABLE");
        return source;
    }
    @Override public SourceAuthority.UploadSession requireUploadSession(ForwardActor actor,long session) {
        var result=data.read(context(actor),"forward-upload-sessions/"+session);
        if(result==null || !Long.toString(actor.enterpriseId()).equals(result.path("enterpriseId").asText()) || !Long.toString(session).equals(result.path("sessionId").asText())
            || !Long.toString(actor.userId()).equals(result.path("actor").path("userId").asText()) || !"TENANT".equals(result.path("backend").asText())) throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        return new SourceAuthority.UploadSession(actor,ForwardBackend.TENANT,session,actor.enterpriseId());
    }
    @Override public SourceMessage readMessage(ForwardActor actor, ForwardBackend backend, long group, long message) {
        if (backend != ForwardBackend.TENANT) throw new IllegalArgumentException("FORWARD_RESOURCE_UNRESOLVABLE");
        return readMessage(actor, group, message);
    }

    @Override public SourceAuthority.UploadSession requireUploadSession(ForwardActor actor, ForwardBackend backend, long session) {
        if (backend != ForwardBackend.TENANT) throw new IllegalArgumentException("FORWARD_RESOURCE_UNRESOLVABLE");
        return requireUploadSession(actor, session);
    }

}
