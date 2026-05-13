package com.iwhalecloud.byai.gateway.sandbox.workspace;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.gateway.sandbox.workspace.model.SandboxFsInitContext;

/**
 * Initializes sandbox bootstrap files in workspace storage during sandbox launch.
 */
@Component
public class SandboxWorkspaceBootstrapInitializer {

    private static final Logger log = LoggerFactory.getLogger(SandboxWorkspaceBootstrapInitializer.class);

    private final UserFS userFS;

    public SandboxWorkspaceBootstrapInitializer(UserFS userFS) {
        this.userFS = userFS;
    }

    public void initialize(SandboxFsInitContext ctx) {
        String relativePath = resolveBootstrapRelativePath();
        if (StringUtils.isNotBlank(ctx.getTemplateJson())) {
            byte[] jsonBytes = ctx.getTemplateJson().getBytes(StandardCharsets.UTF_8);
            userFS.write(toMultipartFile("openclaw.json", jsonBytes), relativePath + "/openclaw.json");
        }
        else {
            log.warn("Template JSON is empty or null; skipping template upload");
        }

        if (ctx.getUserInfo() != null) {
            byte[] json = JSON.toJSONString(ctx.getUserInfo()).getBytes(StandardCharsets.UTF_8);
            userFS.write(toMultipartFile("by_user_info.json", json), relativePath + "/identity/by_user_info.json");
        }
    }

    private String resolveBootstrapRelativePath() {
        return "/.openclaw";
    }

    private MultipartFile toMultipartFile(String filename, byte[] bytes) {
        return new ByteArrayMultipartFile(filename, bytes);
    }

    private static final class ByteArrayMultipartFile implements MultipartFile {

        private final String filename;
        private final byte[] bytes;

        private ByteArrayMultipartFile(String filename, byte[] bytes) {
            this.filename = filename;
            this.bytes = bytes;
        }

        @Override
        public String getName() {
            return filename;
        }

        @Override
        public String getOriginalFilename() {
            return filename;
        }

        @Override
        public String getContentType() {
            return "application/json";
        }

        @Override
        public boolean isEmpty() {
            return bytes == null || bytes.length == 0;
        }

        @Override
        public long getSize() {
            return bytes == null ? 0L : bytes.length;
        }

        @Override
        public byte[] getBytes() {
            return bytes == null ? new byte[0] : bytes.clone();
        }

        @Override
        public ByteArrayInputStream getInputStream() {
            return new ByteArrayInputStream(getBytes());
        }

        @Override
        public void transferTo(java.io.File dest) {
            throw new UnsupportedOperationException("transferTo is not supported");
        }
    }
}
