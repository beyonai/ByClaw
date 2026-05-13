package com.iwhalecloud.byai.common.cache;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-05-12 10:23:31
 * @description TODO
 */
@Getter
@Setter
public class ShareBfmUser {

    private Long userId;

    private String userName;

    private String pwd;

    private Long comAcctId;

    private Long orgId;

    private String phone;

    private String userCode;

    private String parentId;

    /**
     * 驻地ID
     */
    private Long stationId;

    private String sourceSystem;

}
