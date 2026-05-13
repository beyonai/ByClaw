package com.iwhalecloud.byai.state.interfaces.controller.manage.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 系统配置列表响应
 * 包含所有去重的参数类型和参数代码列表
 *
 * @author system
 * @date 2025-11-14
 */
@Setter
@Getter
@Schema(description = "系统配置列表响应")
public class SystemConfigListResponse {

    /**
     * 参数类型列表（去重）
     */
    @Schema(description = "参数类型列表（去重）", example = "[\"THIRD_AGENT_URL\", \"DAILY_CHAT_LIMIT\"]")
    private List<String> paramTypeList;

    /**
     * 参数代码列表（去重）
     */
    @Schema(description = "参数代码列表（去重）", example = "[\"DAILY_CHAT_LIMIT\", \"MAX_SESSION_COUNT\"]")
    private List<String> paramCodeList;
}

