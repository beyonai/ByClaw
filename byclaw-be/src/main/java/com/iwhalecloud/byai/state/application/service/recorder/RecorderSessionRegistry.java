package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSessionAction;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSessionState;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderStateMachine;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.Objects;
import org.springframework.stereotype.Component;

@Component
public class RecorderSessionRegistry {

    private final AtomicLong sequence = new AtomicLong();
    private final Map<String, RecorderSession> sessions = new ConcurrentHashMap<>();

    public RecorderSession createSession(RecorderOwner owner, String contextId, String targetId, boolean awaitingLogin) {
        return createSession(owner, contextId, targetId, awaitingLogin, "tab_projection");
    }

    public RecorderSession createSession(
        RecorderOwner owner,
        String contextId,
        String targetId,
        boolean awaitingLogin,
        String recordingMode
    ) {
        Objects.requireNonNull(owner, "owner");
        RecorderSession session = new RecorderSession(nextId("session"), owner);
        session.contextId(contextId);
        session.targetId(targetId);
        session.recordingMode(recordingMode);
        session.awaitingLogin(awaitingLogin);
        session.state(awaitingLogin ? RecorderSessionState.AWAITING_USER_LOGIN : RecorderSessionState.SESSION_BOUND);
        sessions.put(session.sessionId(), session);
        return session;
    }

    public Optional<RecorderSession> get(String sessionId) {
        return Optional.ofNullable(sessions.get(sessionId));
    }

    public Optional<RecorderSession> getOwned(String sessionId, RecorderOwner owner) {
        Objects.requireNonNull(owner, "owner");
        return get(sessionId).filter(session -> session.owner().sameAs(owner));
    }

    public boolean exists(String sessionId) {
        return sessions.containsKey(sessionId);
    }

    public boolean canAdvance(RecorderSession session, RecorderSessionAction action) {
        return RecorderStateMachine.canTransition(session.state(), action);
    }

    public boolean advance(RecorderSession session, RecorderSessionAction action, RecorderSessionState next) {
        if (!canAdvance(session, action)) {
            return false;
        }
        session.state(next);
        return true;
    }

    public boolean cancel(String sessionId) {
        RecorderSession session = sessions.get(sessionId);
        if (session == null) {
            return false;
        }
        if (!session.state().isTerminal()) {
            session.state(RecorderSessionState.CANCELLED);
        }
        return true;
    }

    private String nextId(String prefix) {
        return prefix + "_" + Long.toString(System.currentTimeMillis(), 36) + "_" + Long.toString(sequence.incrementAndGet(), 36);
    }
}
