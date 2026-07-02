package com.iwhalecloud.byai.manager.vo.users;

import java.util.Date;

import lombok.Getter;
import lombok.Setter;

/**
 * 用户个人参数配置安全视图，不返回参数值明文。
 * @author qin.guoquan
 * @date 2026-06-22 00:00:00
 */
@Getter
@Setter
public class UserPrivateParamVO {

    private Long paramId;

    private String key;

    private String description;

    private String status;

    private Boolean enabled;

    private Boolean hasValue;

    private String valueLast4;

    private Date updateTime;
}
