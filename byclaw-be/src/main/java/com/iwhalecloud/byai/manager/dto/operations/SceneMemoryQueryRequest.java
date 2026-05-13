package com.iwhalecloud.byai.manager.dto.operations;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import jakarta.validation.constraints.NotNull;
import java.io.Serial;
import java.io.Serializable;

/**
 * 场景记忆查询请求DTO
 * 
 * @author system
 * &#064;date  2025-01-XX
 */
@Data
@Schema(description = "场景记忆查询请求")
public class SceneMemoryQueryRequest implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 场景ID（101：常问问题用户）
     */
    @NotNull(message = "场景ID不能为空")
    @Schema(description = "场景ID（101：常问问题用户）", example = "101", requiredMode = Schema.RequiredMode.REQUIRED)
    private Long memSceneId;

    /**
     * 数字员工ID
     */
    @NotNull(message = "数字员工ID不能为空")
    @Schema(description = "数字员工ID", example = "10815897")
    private Long agentId;

}

