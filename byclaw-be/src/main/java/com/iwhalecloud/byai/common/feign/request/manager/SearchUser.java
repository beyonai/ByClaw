package com.iwhalecloud.byai.common.feign.request.manager;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class SearchUser {

    private String pathName;

    private String userCode;

    private Long userId;

    private String userName;
}
