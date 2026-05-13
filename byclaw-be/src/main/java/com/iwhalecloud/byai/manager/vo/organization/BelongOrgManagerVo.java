package com.iwhalecloud.byai.manager.vo.organization;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-06-23 16:00:46
 * @description TODO
 */
@Getter
@Setter
public class BelongOrgManagerVo {

    private Long userId;

    private String userCode;

    private String userName;

    private Long grantObjId;
}
