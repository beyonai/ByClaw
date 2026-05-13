package com.iwhalecloud.byai.manager.dto.position;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.io.Serial;
import java.io.Serializable;
import java.util.List;

/**
 * 岗位与用户绑定请求DTO
 */
@Getter
@Setter
public class PositionUserBindDTO implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 岗位ID
     */
    @NotNull(message = "{position.positionid.notnull}")
    private Long positionId;

    /**
     * 用户ID
     */
    @NotEmpty(message = "{user.userid.notnull}")
    private List<Long> userIds;
}
