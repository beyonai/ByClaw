package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import com.iwhalecloud.byai.common.lock.TransactionalRedisLockService;
import org.springframework.stereotype.Component;
import com.iwhalecloud.byai.state.domain.chat.service.ChatGatewaySendGuard.Lease;

/** Renewable Redis gate across send/STOP; independent of business transactions and synchronous callbacks. */
@Component
public class GroupChatSessionSendGate {
    private final TransactionalRedisLockService locks;

    public GroupChatSessionSendGate(TransactionalRedisLockService locks) { this.locks = locks; }

    public Lease acquire(Long sessionId) {
        if (sessionId == null) throw new IllegalArgumentException("sessionId is required");
        String key = "group-send:" + sessionId;
        var lock = locks.obtain(key);
        return () -> {
            try { locks.validate(key); }
            finally { lock.unlock(); }
        };
    }
}
