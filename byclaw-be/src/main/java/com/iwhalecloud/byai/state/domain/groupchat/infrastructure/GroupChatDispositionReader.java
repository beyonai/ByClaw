package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import java.io.InputStream;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatDisposition;

/** 从用户工作区读取并严格校验当前 dispatch 的 disposition 文件。 */
@Service
public class GroupChatDispositionReader {
    private static final int MAX_BYTES = 16 * 1024;
    private final UserFS userFS;
    private final SandboxUserContextRunner userContextRunner;
    private final ObjectMapper objectMapper;

    public GroupChatDispositionReader(UserFS userFS, SandboxUserContextRunner userContextRunner,
        ObjectMapper objectMapper) {
        this.userFS = userFS;
        this.userContextRunner = userContextRunner;
        this.objectMapper = objectMapper;
    }

    public GroupChatDisposition read(String userCode, Long sessionId, Long dispatchId) {
        return userContextRunner.callAsUser(userCode, () -> readCurrent(sessionId, dispatchId));
    }

    private GroupChatDisposition readCurrent(Long sessionId, Long dispatchId) {
        // Agent 沙箱看到 /by/.sessions；UserFS 的用户桶对象键从 /.sessions 开始。
        String path = "/.sessions/" + sessionId + "/.byclaw/group-chat-disposition.json";
        try (InputStream input = userFS.read(path)) {
            if (input == null) {
                return null;
            }
            byte[] bytes = input.readNBytes(MAX_BYTES + 1);
            if (bytes.length > MAX_BYTES) {
                return null;
            }
            GroupChatDisposition disposition = objectMapper.readValue(bytes, GroupChatDisposition.class);
            if (!GroupChatDispatchPromptBuilder.SCHEMA_VERSION.equals(disposition.getSchemaVersion())
                || !String.valueOf(dispatchId).equals(disposition.getDispatchId())
                || (!"TASK".equals(disposition.getKind()) && !"CHAT".equals(disposition.getKind()))
                || ("TASK".equals(disposition.getKind()) && StringUtils.isBlank(disposition.getTaskName()))) {
                return null;
            }
            disposition.setTaskName(StringUtils.trim(disposition.getTaskName()));
            disposition.setAckText(StringUtils.trimToNull(disposition.getAckText()));
            return disposition;
        }
        catch (Exception ignored) {
            // 文件可能尚未写完；terminal 前由调用方继续保持 UNKNOWN。
            return null;
        }
    }
}
