package com.iwhalecloud.byai.manager.qo.index;

import lombok.Getter;
import lombok.Setter;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-11-12 23:55:02
 * @description TODO
 */
@Getter
@Setter
public class MyCreatedQo {

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

    /**
     * 创建用户
     */
    private Long userId;

    /**
     * 目录分类
     */
    private Long catalogId;

    /**
     * 后端按 catalogId 展开后的当前目录及子目录 ID。
     */
    private List<Long> catalogIds;

}
