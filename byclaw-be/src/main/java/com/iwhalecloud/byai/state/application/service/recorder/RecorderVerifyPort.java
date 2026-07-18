package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
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

    default String start(
        RecorderOwner owner,
        String canonicalRequestId,
        String sessionId,
        String name,
        String adapterPath,
        Map<String, Object> executionSeedArgs
    ) {
        return start(canonicalRequestId, sessionId, name, adapterPath, executionSeedArgs);
    }

    default String start(
        RecorderOwner owner,
        String canonicalRequestId,
        String sessionId,
        String name,
        String adapterPath,
        String expectedSourceSha256,
        Map<String, Object> executionSeedArgs
    ) {
        return start(canonicalRequestId, sessionId, name, adapterPath, expectedSourceSha256, executionSeedArgs);
    }

    Map<String, Object> status(String daemonRequestId);

    default Map<String, Object> status(RecorderOwner owner, String daemonRequestId) {
        return status(daemonRequestId);
    }
}
