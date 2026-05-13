package com.iwhalecloud.byai.state.interfaces.controller.manage.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.io.Serializable;

/**
 * 模板会话详情查询请求DTO
 * 
 * @author smartcloud
 * @version 1.0
 * @since 1.0
 */
@Data
@Schema(description = "模板会话详情查询请求")
public class TemplateSessionDetailRequestDto implements Serializable {

    /**
     * 会话ID
     */
    @NotNull(message = "会话ID不能为空")
    @Schema(description = "会话ID", example = "1234567890", required = true)
    private Long sessionId;
}
