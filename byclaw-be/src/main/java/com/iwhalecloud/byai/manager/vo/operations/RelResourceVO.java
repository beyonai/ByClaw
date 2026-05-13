package com.iwhalecloud.byai.manager.vo.operations;

import java.io.Serial;
import java.io.Serializable;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

import lombok.Getter;
import lombok.Setter;

/**
 * 关联资源VO
 */
@Getter
@Setter
public final class RelResourceVO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 关联资源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long relResourceId;

    /**
     * 资源名称
     */
    private String resourceName;

    /**
     * 资源业务类型
     */
    private String resourceBizType;
}