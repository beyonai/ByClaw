package com.iwhalecloud.byai.state.domain.groupchat.authorization;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import com.iwhalecloud.byai.manager.entity.session.ByaiSession;

/** Routing assessments are backend control sessions and never public conversation content. */
public final class GroupChatInternalSessionAccess {
    private GroupChatInternalSessionAccess() {
    }

    public static boolean isInternal(ByaiSession session) {
        return session != null && "GROUP_CHAT_ROUTING".equals(session.getState());
    }

    public static void requirePublic(ByaiSession session) {
        if (isInternal(session)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Session not found");
        }
    }
}
