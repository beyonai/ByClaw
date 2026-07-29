package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;

public interface RecorderVncProvider {

    RecorderVncEndpoint start(String sessionId);

    default RecorderVncEndpoint start(RecorderSession session) {
        return start(session.sessionId());
    }

    void stop(String sessionId);

    void stopAll();
}
