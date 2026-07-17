package com.iwhalecloud.byai.state.application.service.recorder;

import java.util.Map;

public interface RecorderVerifyPort {

    String start(
        String canonicalRequestId,
        String sessionId,
        String name,
        String adapterPath,
        Map<String, Object> executionSeedArgs
    );

    default String start(
        String canonicalRequestId,
        String sessionId,
        String name,
        String adapterPath,
        String expectedSourceSha256,
        Map<String, Object> executionSeedArgs
    ) {
        return start(canonicalRequestId, sessionId, name, adapterPath, executionSeedArgs);
    }

    Map<String, Object> status(String daemonRequestId);
}
