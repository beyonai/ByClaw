package com.iwhalecloud.byai.manager.qo.position;

import com.iwhalecloud.byai.common.qo.QueryObject;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 岗位管理员查询对象
 */
@Getter
@Setter
public class PositionAdminSearchQO extends QueryObject {

    /**
     * 岗位ID
     */
    @NotNull(message = "{position.positionid.notnull}")
    private Long positionId;

    /**
     * 用户名（可选，模糊查询）
     */
    private String userName;
}
