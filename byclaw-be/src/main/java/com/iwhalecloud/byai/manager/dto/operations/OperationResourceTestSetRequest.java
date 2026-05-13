package com.iwhalecloud.byai.manager.dto.operations;


import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 获取对应批次上传测试集的请求对象
 * @author zzh
 */
@Data
public class OperationResourceTestSetRequest {
    /**
     * 数字员工ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(message = "{operations.digemployee.resource.id.not.null}")
    private Long resourceId;

    /**
     * 对应消息的relId
     */
    @NotBlank(message = "{operations.digemployee.batchId.not.null}")
    private String batchId;


}
