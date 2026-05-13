package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 删除授权对象数据传输对象
 */
@Getter
@Setter
public class DeleteAuthorizedObjectDTO {

    /**
     * 关联ID
     */
    @NotNull(message = "{authorizedobject.id.notnull}")
    private Long id;

}

