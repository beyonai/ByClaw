package com.iwhalecloud.byai.manager.application.service.devloop;

import java.io.IOException;
import java.io.InputStream;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskStateDto;
import com.iwhalecloud.byai.manager.dto.devloop.IntegrationResultDto;

@Service
public class DevloopTaskStateReader {

    static final String SESSION_STATE_PATH = "/by/.acp-runs/sessions/%s.json";
    private static final String SUPPORTED_SCHEMA_VERSION = "2.0.0";

    /** 测试员工写入的集成结果文件;字段为 camelCase,用不改命名策略的原始 mapper 读。 */
    private static final String INTEGRATION_RESULT_PATH = "/by/.sessions/%s/integration-result.json";

    private final UserFS userFS;
    private final SandboxUserContextRunner userContextRunner;
    private final ObjectMapper projectionObjectMapper;
    private final ObjectMapper resultObjectMapper;

    public DevloopTaskStateReader(UserFS userFS, SandboxUserContextRunner userContextRunner, ObjectMapper objectMapper) {
        this.userFS = userFS;
        this.userContextRunner = userContextRunner;
        this.projectionObjectMapper = objectMapper.copy()
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        this.resultObjectMapper = objectMapper.copy();
    }

    public DevloopTaskStateDto read(String userCode, Long sessionId) {
        return userContextRunner.callAsUser(userCode, () -> readProjection(sessionId));
    }

    /**
     * 读集成测试结果文件(测试员工写)。文件缺失(员工尚未写完)返回 null,由 poller 按未完成继续等待;
     * 存在则解析结构化计数供看板列使用。
     */
    public IntegrationResultDto readIntegrationResult(String userCode, Long sessionId) {
        return userContextRunner.callAsUser(userCode, () -> readResult(sessionId));
    }

    private IntegrationResultDto readResult(Long sessionId) {
        String path = INTEGRATION_RESULT_PATH.formatted(sessionId);
        try (InputStream inputStream = userFS.read(path)) {
            if (inputStream == null) {
                return null;
            }
            return resultObjectMapper.readValue(inputStream, IntegrationResultDto.class);
        }
        catch (IOException e) {
            // 文件不存在是正常态(员工还没写),不抛错,交 poller 继续等待。
            return null;
        }
    }

    private DevloopTaskStateDto readProjection(Long sessionId) {
        String path = SESSION_STATE_PATH.formatted(sessionId);
        try (InputStream inputStream = userFS.read(path)) {
            DevloopTaskStateDto state = projectionObjectMapper.readValue(inputStream, DevloopTaskStateDto.class);
            if (!SUPPORTED_SCHEMA_VERSION.equals(state.getSchemaVersion())) {
                throw new IllegalStateException(I18nUtil.get("devloop.task.state.version.unsupported",
                    state.getSchemaVersion()));
            }
            if (!String.valueOf(sessionId).equals(state.getSessionId())) {
                throw new IllegalStateException(I18nUtil.get("devloop.task.state.session.mismatch"));
            }
            return state;
        }
        catch (IOException e) {
            throw new IllegalStateException(I18nUtil.get("devloop.task.state.read.failed", e.getMessage()), e);
        }
    }
}
