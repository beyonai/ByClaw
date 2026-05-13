package com.iwhalecloud.byai.common.feign.response.knowledge;


import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter

public class UnSubscribeDto {

    /**
     * 取消订阅的类型
     * DOC,AGENT,PLUGIN,DB
     */
    private String type;

    /**
     * 取消订阅的id列表
     */
    private List<Long> idList;
}
