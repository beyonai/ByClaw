package com.iwhalecloud.byai.manager.dto.openapi;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.util.List;

/**
 * 本体资源同步结果。
 *
 * @author qin.guoquan
 * @date 2026-07-06 16:05:00
 */
@Data
@Schema(description = "本体资源同步结果")
public class OntologyResourceSyncResultDto {

    @Schema(description = "操作动作：created / updated / deleted / not_found")
    private String action;

    @JsonSerialize(using = ToStringSerializer.class)
    @Schema(description = "资源 ID")
    private Long resourceId;

    @Schema(description = "批量删除资源 ID")
    private List<Long> resourceIds;

    @Schema(description = "资源业务类型")
    private String resourceBizType;

    @Schema(description = "资源编码")
    private String resourceCode;

    @Schema(description = "所属本体库编码")
    private String ontologyBaseCode;
}
