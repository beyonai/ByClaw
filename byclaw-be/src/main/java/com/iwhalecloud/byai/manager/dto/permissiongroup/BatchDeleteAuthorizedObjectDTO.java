package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotEmpty;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 批量删除授权对象数据传输对象
 */
@Getter
@Setter
public class BatchDeleteAuthorizedObjectDTO {

    /**
     * 关联ID列表
     */
    @NotEmpty(message = "{authorizedobject.ids.notempty}")
    private List<Long> ids;

}

