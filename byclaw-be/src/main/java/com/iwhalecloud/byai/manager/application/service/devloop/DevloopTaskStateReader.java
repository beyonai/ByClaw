package com.iwhalecloud.byai.manager.application.service.devloop;

import java.io.IOException;
import java.io.InputStream;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskStateDto;

@Service
public class DevloopTaskStateReader {

    static final String SESSION_STATE_PATH = "/by/.acp-runs/sessions/%s.json";
    private static final String SUPPORTED_SCHEMA_VERSION = "2.0.0";

    private final UserFS userFS;
    private final SandboxUserContextRunner userContextRunner;
    private final ObjectMapper projectionObjectMapper;

    public DevloopTaskStateReader(UserFS userFS, SandboxUserContextRunner userContextRunner, ObjectMapper objectMapper) {
        this.userFS = userFS;
        this.userContextRunner = userContextRunner;
        this.projectionObjectMapper = objectMapper.copy()
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
    }

    public DevloopTaskStateDto read(String userCode, Long sessionId) {
        return userContextRunner.callAsUser(userCode, () -> readProjection(sessionId));
    }

    private DevloopTaskStateDto readProjection(Long sessionId) {
        String path = SESSION_STATE_PATH.formatted(sessionId);
        try (InputStream inputStream = userFS.read(path)) {
            DevloopTaskStateDto state = projectionObjectMapper.readValue(inputStream, DevloopTaskStateDto.class);
            if (!SUPPORTED_SCHEMA_VERSION.equals(state.getSchemaVersion())) {
                throw new IllegalStateException("不支持的任务状态版本: " + state.getSchemaVersion());
            }
            if (!String.valueOf(sessionId).equals(state.getSessionId())) {
                throw new IllegalStateException("任务状态会话标识不匹配");
            }
            return state;
        }
        catch (IOException e) {
            throw new IllegalStateException("读取任务状态失败: " + e.getMessage(), e);
        }
    }
}
