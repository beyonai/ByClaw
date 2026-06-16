package com.iwhalecloud.byai.manager.dto.aimodel;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 设置默认模型入参
 *
 * @author he.duming
 * @date 2026-05-29 15:46:27
 */
@Getter
@Setter
public class ModelDefault {

    /** 模型 ID */
    @NotNull(message = "{aimodel.modelId.required}")
    private Long modelId;

    /** 标签 ID */
    private Long tagId;

    /** 模型类型 */
    private String modelType;
}
