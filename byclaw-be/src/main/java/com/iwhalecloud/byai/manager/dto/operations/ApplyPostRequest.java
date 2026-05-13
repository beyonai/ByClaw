package com.iwhalecloud.byai.manager.dto.operations;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.List;

/**
 * 申请上岗请求
 */
@Data
public class ApplyPostRequest {

    /**
     * 资源ID
     */
    @NotNull(message = "{apply.post.resource.id.not.null}")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 审核人ID
     */
    @NotEmpty(message = "{apply.post.auditor.id.not.null}")
    private List<Long> auditorIds;

    /**
     * 目录业务领域ID
     */
    @NotNull(message = "{apply.post.catalog.id.not.null}")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long catalogId;

    /**
     * 申请的数字岗位
     */
    @NotNull(message = "{apply.post.positionId.not.null}")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long positionId;

    /**
     * 上岗申请理由
     */
    @NotBlank(message = "{apply.post.reason.not.blank}")
    @Size(max = 500, message = "{apply.post.reason.size}")
    private String reason;

}
