package com.iwhalecloud.byai.manager.vo.auth;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ManPrivDto {
    private Long grantObjId;

    private Long grantToObjId;

    private String userName;
}
