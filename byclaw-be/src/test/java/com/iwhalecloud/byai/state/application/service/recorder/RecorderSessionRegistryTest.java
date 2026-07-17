package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNullPointerException;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import org.junit.jupiter.api.Test;

class RecorderSessionRegistryTest {

    @Test
    void sessionRegistrationAndOwnedLookupRequireOwner() {
        RecorderSessionRegistry registry = new RecorderSessionRegistry();

        assertThatNullPointerException().isThrownBy(() -> registry.createSession(null, "default", null, false));
        assertThatNullPointerException().isThrownBy(() -> registry.getOwned("session", null));
        assertThatNullPointerException().isThrownBy(() -> new RecorderSession("session", null));
    }

    @Test
    void sessionIsVisibleOnlyToItsExactImmutableOwner() {
        RecorderSessionRegistry registry = new RecorderSessionRegistry();
        RecorderOwner alice = new RecorderOwner(1L, "alice");
        RecorderSession session = registry.createSession(alice, "default", null, false, "tab_projection");

        assertThat(registry.getOwned(session.sessionId(), alice)).containsSame(session);
        assertThat(registry.getOwned(session.sessionId(), new RecorderOwner(2L, "bob"))).isEmpty();
        assertThat(registry.getOwned(session.sessionId(), new RecorderOwner(1L, "alice-renamed"))).isEmpty();
        assertThat(session.owner()).isEqualTo(alice);
    }
}
