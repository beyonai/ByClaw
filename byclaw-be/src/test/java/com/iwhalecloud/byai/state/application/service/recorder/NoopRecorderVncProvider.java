package com.iwhalecloud.byai.state.application.service.recorder;

public final class NoopRecorderVncProvider implements RecorderVncProvider {

    @Override
    public RecorderVncEndpoint start(String sessionId) {
        return new RecorderVncEndpoint("managed", "http://127.0.0.1:16080/vnc.html", "127.0.0.1", 17000, "bycli-vnc-test", 16080);
    }

    @Override
    public void stop(String sessionId) {
    }

    @Override
    public void stopAll() {
    }
}
