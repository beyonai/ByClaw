package com.iwhalecloud.byai.state.common.exception;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Existing unfinished uploads require an explicit resume or cancellation choice. */
public final class StorageUploadAdmissionException extends ResponseStatusException {
    private final String retryAfter;
    public StorageUploadAdmissionException(String retryAfter) {
        super(HttpStatus.TOO_MANY_REQUESTS, "未完成上传数量已达上限，请继续或取消已有上传后重试");
        this.retryAfter = retryAfter;
    }
    public String getRetryAfter() { return retryAfter; }
    public Map<String,Object> details() {
        return Map.of("errorType", "upload_admission_full", "retryAfterMs", Long.parseLong(retryAfter) * 1000,
            "action", "MANAGE_UNFINISHED_UPLOADS");
    }
}
