package com.iwhalecloud.byai.manager.qo.searchask;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-03-04 16:49:55
 * @description TODO
 */
@Getter
@Setter
public class RecentlySearchAskQo {

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
    private Long creatorId;

    /**
     * 会话类型
     */
    private String sessionType;

    private Long objectId;

    private Long objectType;
}
