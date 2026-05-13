package com.iwhalecloud.byai.common.page;

import java.util.List;

import lombok.Getter;
import lombok.Setter;

/**
 * Created by chenxm on 2017/9/27.
 */
@Getter
@Setter
public class PageInfo<T> {

    /**
     * 页码，默认是第一页
     */
    private int pageNum = 1;

    /**
     * 每页显示的记录数，默认是10
     */
    private int pageSize = 10;

    /**
     * 总记录数
     */
    private long total;

    /**
     * 总页数
     */
    private int totalPages;

    /**
     * 当前页数据列表
     */
    private List<T> list;

}
