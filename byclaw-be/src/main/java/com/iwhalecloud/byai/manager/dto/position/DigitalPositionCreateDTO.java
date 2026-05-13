package com.iwhalecloud.byai.manager.dto.position;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;
import java.util.List;

/**
 * 创建数字岗位请求DTO
 */
@Getter
@Setter
public class DigitalPositionCreateDTO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 领域ID集合（支持多选）
     */
    @NotEmpty(message = "{position.catalogids.notempty}")
    private List<Long> catalogIds;

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


