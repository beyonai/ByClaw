package com.iwhalecloud.byai.manager.dto.resource;

import java.io.Serial;
import java.io.Serializable;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 资源数据集查询DTO
 */
@Getter
@Setter
public class DBDatasetQueryDto implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 资源ID（数据集ID）
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(message = "{resource.id.required}")
    private Long resourceId;


}

