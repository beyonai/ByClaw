package com.iwhalecloud.byai.state.domain.sys.dto;

import lombok.Data;

/**
 * 应用版本管理页筛选与分页参数，全部可选。
 */
@Data
public class AppVersionQuery {

    private String platform;

    private String arch;

    private String channel;

    private String releaseStatus;

    /**
     * 按版本号或文件名模糊匹配
     */
    private String keyword;

    private Integer page;

    private Integer size;
}