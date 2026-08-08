package com.iwhalecloud.byai.manager.application.service.devloop;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import org.apache.commons.lang3.StringUtils;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskStateDto;
import com.iwhalecloud.byai.manager.dto.devloop.E2eStatusDto;
import com.iwhalecloud.byai.manager.dto.devloop.IntegrationResultDto;

@Service
public class DevloopTaskStateReader {

    static final String SESSION_STATE_PATH = "/by/.acp-runs/sessions/%s.json";
    private static final String SUPPORTED_SCHEMA_VERSION = "2.0.0";

    /** 测试员工写入的集成结果文件;字段为 camelCase,用不改命名策略的原始 mapper 读。 */
    private static final String INTEGRATION_RESULT_PATH = "/by/.sessions/%s/integration-result.json";

    /** 结果根目录,结构见规范页 /spec/integrationTest:status.json + reports/ + logs/ + artifacts/。 */
    private static final String E2E_RESULT_DIR = "/by/.sessions/%s/e2e-result";

    private static final String E2E_STATUS_PATH = E2E_RESULT_DIR + "/status.json";

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

    /**
     * 读 status.json(规范页 /spec/integrationTest 定义的结果真相源)。它比 integration-result.json
     * 多带状态、失败用例 message 与截图路径,故优先读它;缺失时调用方退回旧五字段文件。
     */
    public E2eStatusDto readE2eStatus(String userCode, Long sessionId) {
        return userContextRunner.callAsUser(userCode, () -> readStatus(sessionId));
    }

    private E2eStatusDto readStatus(Long sessionId) {
        String path = E2E_STATUS_PATH.formatted(sessionId);
        try (InputStream inputStream = userFS.read(path)) {
            if (inputStream == null) {
                return null;
            }
            return resultObjectMapper.readValue(inputStream, E2eStatusDto.class);
        }
        catch (IOException e) {
            // 缺失是正常态(员工尚未写或用的是旧结果文件),交调用方走回退路径。
            return null;
        }
    }

    /**
     * 读结果根目录下的文本产物(报告/日志)。relativePath 由 status.json 的 report/log 字段给出,
     * 必须是相对路径且不含 .. :它来自数字员工写的文件,当外部输入防目录穿越。
     */
    public String readE2eArtifactText(String userCode, Long sessionId, String relativePath) {
        String clean = StringUtils.strip(StringUtils.defaultString(relativePath), "/");
        if (StringUtils.isBlank(clean) || clean.contains("..")) {
            return null;
        }
        String path = E2E_RESULT_DIR.formatted(sessionId) + "/" + clean;
        return userContextRunner.callAsUser(userCode, () -> {
            try (InputStream inputStream = userFS.read(path)) {
                return inputStream == null ? null
                    : new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
            }
            catch (IOException e) {
                return null;
            }
        });
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
