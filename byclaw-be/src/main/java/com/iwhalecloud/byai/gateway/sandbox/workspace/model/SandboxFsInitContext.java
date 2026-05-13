package com.iwhalecloud.byai.gateway.sandbox.workspace.model;

import lombok.Builder;
import lombok.Getter;

import java.nio.file.Path;
import java.util.Map;

@Getter
@Builder
public class SandboxFsInitContext {
    /** User code, used for path isolation. */
    private final String userCode;
    /** Service key used when writing the identity file; may be null. */
    private final String serviceKey;
    /** Host-local template directory (read via NIO, independent of storage backend); null to skip template copy. */
    private final Path templateSourcePath;
    /** Target storage path prefix (e.g. "/data/byai/openclaw/user001/openclaw"). */
    private final String workspaceTargetPath;
    /** User identity info serialized to identity/by_user_info.json; may be null. */
    private final Map<String, Object> userInfo;
    /** template for openclaw.json */
    private final String templateJson;
}
