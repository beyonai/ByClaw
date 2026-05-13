package com.iwhalecloud.byai.manager.dto.position;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;

/**
 * 更新数字岗位请求DTO
 */
@Getter
@Setter
public class DigitalPositionUpdateDTO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 岗位ID
     */
    @NotNull(message = "{position.positionid.notnull}")
    private Long positionId;

    /**
     * 岗位名称
     */
    @NotEmpty(message = "{position.positionname.notempty}")
    @Size(max = 50, message = "{position.positionname.size}")
    @Pattern(regexp = "^[a-zA-Z0-9\\p{IsHan}]+$", message = "{position.positionname.validate}")
    private String positionName;

    /**
     * 岗位描述
     */
    @Size(max = 500, message = "{position.positiondesc.size}")
    private String positionDesc;
}
