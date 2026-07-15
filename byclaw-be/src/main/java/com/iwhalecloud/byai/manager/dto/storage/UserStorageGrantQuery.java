package com.iwhalecloud.byai.manager.dto.storage;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class UserStorageGrantQuery {

    private Integer pageNum = 1;

    private Integer pageSize = 20;

    /** 用户编码模糊查询。 */
    private String userCode;

    /** 增值包标识精确查询。 */
    private Long packageId;
}
