package com.iwhalecloud.byai.manager.qo.conversation;


import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class FilterQo {
    /**
     * 关键字搜索
     */
    private String keyWord;

    /**
     * 页大小
     */
    private Integer pageSize;

    /**
     * 页码
     */
    private Integer pageIndex;
}
