package com.iwhalecloud.byai.manager.dto.users;

import lombok.Getter;
import lombok.Setter;

/**
 * 用户个人参数配置保存/删除/启停请求。
 * @author qin.guoquan
 * @date 2026-06-22 00:00:00
 */
@Getter
@Setter
public class UserPrivateParamDTO {

    private Long paramId;

    private String key;

    private String value;

    private String description;

    private Boolean enabled;

    private Integer pageNum;

    private Integer pageSize;

    private String keyword;

    private String status;

    private String updateTimeSort;
}
