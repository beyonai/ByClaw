package com.iwhalecloud.byai.manager.dto.operations;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 资源ID的请求体
 * @author zzh
 */
@Data
public class OperationResourceIdRequest {
    /**
     * 数字员工ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(message = "{operations.digemployee.resource.id.not.null}")
    private Long resourceId;

}
