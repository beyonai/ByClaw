package com.iwhalecloud.byai.manager.dto.auth;


import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-05-10 17:32:16
 * @description TODO
 */
@Getter
@Setter
public class AuthManOrgDTO {

    private String grantType;

    private Long grantToObjId;

    private String grantToObjType;


    private String grantObjType;

    private List<ManOrgDTO> redList;
}
