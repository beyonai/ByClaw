package com.iwhalecloud.byai.manager.dto.resource;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.io.Serial;
import java.io.Serializable;
import java.util.List;

/**
 * 保存视图与选中对象关系请求对象
 *
 * @author system
 * &#064;date  2025-01-XX
 */
@Data
@Schema(description = "保存视图与选中对象关系请求")
public class SaveViewResourceRelRequest implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 视图的resourceId（A）
     */
    @NotNull(message = "视图的resourceId不能为空")
    @Schema(description = "视图的resourceId", example = "123456", requiredMode = Schema.RequiredMode.REQUIRED)
    private Long resourceId;

    /**
     * 主对象ID（新接口使用，reset为true时可为空）
     */
    @Schema(description = "主对象ID（reset为true时可为空）", example = "10809030")
    private Long activeResourceId;

    /**
     * 从对象关系列表（新接口使用）
     */
    @Schema(description = "从对象关系列表")
    private List<@Valid RelResourceInfo> relResourceInfoList;

    /**
     * 选中对象的id集合（旧接口使用）
     */
    @Schema(description = "选中对象的id集合（旧接口使用）", example = "[10809030, 10809040]")
    private List<Long> relResourceIdList;

    /**
     * 重置标志，如果为true，则只删除视图的所有关联关系，不做其他业务
     */
    @Schema(description = "重置标志，如果为true，则只删除视图的所有关联关系", example = "false")
    private Boolean reset = false;

    /**
     * 从对象关系信息
     */
    @Data
    @Schema(description = "从对象关系信息")
    public static class RelResourceInfo implements Serializable {
        @Serial
        private static final long serialVersionUID = 1L;

        /**
         * 从对象ID
         */
        @NotNull(message = "从对象ID不能为空")
        @Schema(description = "从对象ID", example = "10809040", requiredMode = Schema.RequiredMode.REQUIRED)
        private Long relResourceId;

        /**
         * 主从之间关联的字段信息（前端传递，后端接收即可）
         */
        @Schema(description = "主从之间关联的字段信息", example = "{\"field1\":\"value1\"}")
        private String relResourceInfo;
    }
}
