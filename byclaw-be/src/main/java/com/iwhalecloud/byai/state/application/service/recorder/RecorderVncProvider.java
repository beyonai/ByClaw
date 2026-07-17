package com.iwhalecloud.byai.state.application.service.recorder;

public interface RecorderVncProvider {

    RecorderVncEndpoint start(String sessionId);

    void stop(String sessionId);

    void stopAll();
}
