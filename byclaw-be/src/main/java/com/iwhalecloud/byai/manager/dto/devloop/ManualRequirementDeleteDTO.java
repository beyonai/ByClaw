package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/**
 * 删除手工录入需求的请求参数。
 * 删除权限由服务端依据需求所属项目的创建者校验，不能相信前端传入的用户或项目标识。
 */
@Data
public class ManualRequirementDeleteDTO {

    /** 待删除的需求条目 ID。 */
    private Long itemId;
}
