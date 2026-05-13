package com.iwhalecloud.byai.manager.dto.openapi;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-06-23 09:37:45
 * @description TODO
 */
@Getter
@Setter
public class PrivilegeQueryDTO {

    private List<Long> grantObjIdList;

}
