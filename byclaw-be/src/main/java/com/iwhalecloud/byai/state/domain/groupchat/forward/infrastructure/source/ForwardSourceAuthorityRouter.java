package com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source;

import com.iwhalecloud.byai.state.domain.groupchat.forward.port.ForwardSourceAuthorityReader;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.SourceAuthority;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardActor;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardBackend;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import com.iwhalecloud.byai.manager.domain.tenant.TenantForwardSourceAuthorityReader;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

/** Initial routing uses server configuration; authorized source locators remain pinned to their owning store. */
@Component @Primary
public class ForwardSourceAuthorityRouter implements ForwardSourceAuthorityReader {
    private final LegacyForwardSourceAuthorityReader legacy; private final TenantForwardSourceAuthorityReader tenant;
    private final TenantAdminTenantMapper tenants; private final TenantMembershipMapper memberships;
    public ForwardSourceAuthorityRouter(LegacyForwardSourceAuthorityReader legacy,TenantForwardSourceAuthorityReader tenant,TenantAdminTenantMapper tenants,TenantMembershipMapper memberships) {
        this.legacy=legacy;this.tenant=tenant;this.tenants=tenants;this.memberships=memberships;
    }
    private void requireMembership(ForwardActor actor) {
        if (actor.enterpriseId() != 1 && memberships.selectActiveMembership(actor.userId(), actor.enterpriseId()) == null) {
            throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        }
    }

    private ForwardBackend configuredBackend(ForwardActor actor) {
        requireMembership(actor);
        return tenants.selectConfig(actor.enterpriseId(), "NODE_SANDBOX_RECORD_ID") == null
            ? ForwardBackend.LEGACY : ForwardBackend.TENANT;
    }

    private ForwardSourceAuthorityReader reader(ForwardActor actor, ForwardBackend backend) {
        // Recheck platform membership even when the owning backend was authorized earlier.
        requireMembership(actor);
        if (backend == null) throw ForwardSourceFacts.unresolved();
        return switch (backend) {
            case LEGACY -> legacy;
            case TENANT -> tenant;
        };
    }

    @Override public SourceMessage readMessage(ForwardActor actor, long group, long message) {
        return readMessage(actor, configuredBackend(actor), group, message);
    }

    @Override public SourceAuthority.UploadSession requireUploadSession(ForwardActor actor, long session) {
        return requireUploadSession(actor, configuredBackend(actor), session);
    }

    @Override public SourceMessage readMessage(ForwardActor actor, ForwardBackend backend, long group, long message) {
        var source = reader(actor, backend).readMessage(actor, group, message);
        var evidence = source == null ? null : source.authority();
        if (evidence == null || !actor.equals(evidence.actor()) || evidence.backend() != backend
            || evidence.sourceSessionId() != group || evidence.selectedMessageId() != message || source.id() != message) {
            throw ForwardSourceFacts.unresolved();
        }
        return source;
    }

    @Override public SourceAuthority.UploadSession requireUploadSession(ForwardActor actor, ForwardBackend backend, long session) {
        var evidence = reader(actor, backend).requireUploadSession(actor, session);
        if (evidence == null || !actor.equals(evidence.actor()) || evidence.enterpriseId() != actor.enterpriseId()
            || evidence.backend() != backend || evidence.sessionId() != session) {
            throw ForwardSourceFacts.unresolved();
        }
        return evidence;
    }
}
