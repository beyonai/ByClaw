package com.iwhalecloud.byai.manager.dto.staticdata;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * 系统配置缓存清除请求
 *
 * @author system
 * @date 2025-11-14
 */
@Setter
@Getter
@Schema(description = "系统配置缓存清除请求")
public class SystemConfigClearCacheRequest {

    /**
     * 参数类型
     * 用于清除按类型分组的缓存（对应refreshListAll的逻辑）
     */
    @Size(max = 128, message = "参数类型长度不能超过128字符")
    @Schema(description = "参数类型，用于清除按类型分组的缓存", example = "THIRD_AGENT_URL")
    private String paramType;

    /**
     * 参数代码
     * 用于清除按代码存储的缓存（对应refreshAll的逻辑）
     */
    @Size(max = 128, message = "参数代码长度不能超过128字符")
    @Schema(description = "参数代码，用于清除按代码存储的缓存", example = "DAILY_CHAT_LIMIT")
    private String paramCode;

    /**
     * 验证请求参数是否有效
     * paramType 和 paramCode 至少需要提供一个
     *
     * @return true 表示参数有效，false 表示参数无效
     */
    public boolean isValid() {
        return (paramType != null && !paramType.trim().isEmpty())
            || (paramCode != null && !paramCode.trim().isEmpty());
    }
}

