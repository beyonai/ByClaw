package com.iwhalecloud.byai.manager.dto.storage;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class UserStorageDowngradeQuery {

    private Integer pageNum = 1;

    private Integer pageSize = 20;

    private String userCode;

    private String downgradeStatus;

    private String requestType;
}
