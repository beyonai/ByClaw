package com.iwhalecloud.byai.state.domain.groupchat.forward.domain;

import java.util.Set;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardActor;

/** Eligibility shared by candidate selection, preparation and final commit. */
public final class ForwardEligibility {
    private static final Set<String> UNAVAILABLE_STATES = Set.of(
        "GROUP_DISSOLVED", "CLOSED", "GROUP_CHAT_ROUTING", "GROUP_CHAT_DISPATCH");

    private ForwardEligibility() { }

    public record GroupIdentity(long sessionId, Long enterpriseId, String sessionType, String state) { }

    public static void requireSource(ForwardActor actor, GroupIdentity source, boolean isUserMember) {
        if (source == null || !isUserMember) throw inaccessible();
        if (source.enterpriseId() == null) throw new IllegalArgumentException("FORWARD_TENANT_UNRESOLVED");
        if (source.enterpriseId() != actor.enterpriseId() || !publicGroup(source)) throw inaccessible();
    }

    /** Caller separately authorizes current source membership; this also rechecks source ownership and state. */
    public static void requireTarget(ForwardActor actor, GroupIdentity source, GroupIdentity target, boolean isUserMember) {
        requireSource(actor, source, true);
        if (target == null || !isUserMember || target.sessionId() == source.sessionId()
            || target.enterpriseId() == null || target.enterpriseId() != actor.enterpriseId()
            || !publicGroup(target)) throw inaccessible();
    }

    private static boolean publicGroup(GroupIdentity group) {
        return "hs_as".equals(group.sessionType())
            && (group.state() == null || !UNAVAILABLE_STATES.contains(group.state()));
    }

    private static IllegalArgumentException inaccessible() {
        return new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
    }
}
