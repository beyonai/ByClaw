package com.iwhalecloud.byai.state.common.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter

public class SubscribeDto {

    /**
     * 取消订阅的类型 DOC,AGENT,PLUGIN,DB
     */
    private String type;

    /**
     * 页码
     */
    private Integer pageIndex;

    /**
     * 页码大小
     */
    private Integer pageSize;

}
