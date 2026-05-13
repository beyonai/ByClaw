package com.iwhalecloud.byai.manager.qo.session;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-02-09 18:41:59
 * @description TODO
 */
@Setter
@Getter
public class SessionByAgentQo {
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

    private Long userId;

    private Long objectId;
}
