package com.iwhalecloud.byai.manager.qo.men;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-01-14 17:36:36
 * @description TODO
 */
@Getter
@Setter
public class FixedMemoryQo {
    /**
     * 分页码
     */
    private Integer pageNum = 1;

    /**
     * 分页大小
     */
    private Integer pageSize = 10;

    /**
     * 关键字搜索
     */
    private String keyword;

    private Long createBy;
}
