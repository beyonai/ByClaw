package com.iwhalecloud.byai.state.domain.callback.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.AllArgsConstructor;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.List;

/**
 * 回调响应DTO
 * 
 * @author system
 * @date 2025-01-27
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "回调响应结果")
public class CallbackResponse implements Serializable {
    private static final long serialVersionUID = 1L;

    @Schema(description = "响应码", example = "200")
    private Integer code;

    @Schema(description = "响应消息", example = "SUCCESS")
    private String message;

    @Schema(description = "响应数据")
    private List<CallbackFile> data;

    /**
     * 成功响应
     */
    public static CallbackResponse success(String requestId) {
        return new CallbackResponse(200, "SUCCESS", requestId, System.currentTimeMillis(), null);
    }

    /**
     * 成功响应带数据
     */
    public static CallbackResponse success(String requestId, List<CallbackFile> data) {
        return new CallbackResponse(200, "SUCCESS", requestId, System.currentTimeMillis(), data);
    }

    /**
     * 失败响应
     */
    public static CallbackResponse failed(String message, String requestId) {
        return new CallbackResponse(400, message, requestId, System.currentTimeMillis(), null);
    }

    /**
     * 签名验证失败响应
     */
    public static CallbackResponse signatureFailed(String requestId) {
        return new CallbackResponse(401, "SIGNATURE_VERIFICATION_FAILED", requestId, System.currentTimeMillis(), null);
    }

    /**
     * 重复请求响应
     */
    public static CallbackResponse duplicateRequest(String requestId) {
        return new CallbackResponse(409, "DUPLICATE_REQUEST", requestId, System.currentTimeMillis(), null);
    }

    // 添加全参数构造函数
    public CallbackResponse(Integer code, String message, String requestId, Long timestamp, List<CallbackFile> data) {
        this.code = code;
        this.message = message;
        this.data = data;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Schema(description = "回调响应结果")
    public static class CallbackFile {
        private String fileName;
        private String fileId;
        private String datasetId;
        private String tags;
        private String msg;
        private String url;
        private String fileUrl;
    }
} 