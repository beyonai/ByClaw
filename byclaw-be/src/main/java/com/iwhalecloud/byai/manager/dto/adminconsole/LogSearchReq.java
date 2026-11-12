package com.iwhalecloud.byai.manager.dto.adminconsole;

import com.iwhalecloud.byai.common.constants.adminconsole.LogSearchConstants;
import lombok.Getter;
import lombok.Setter;

/**
 * 平台日志查询条件，字段名与平台桥接协议保持一致。
 *
 * @author Codex
 * @date 2026-11-12
 */
@Getter
@Setter
public class LogSearchReq {
    private String region;

    private String project;

    private String logstore;

    private Long from;

    private Long to;

    private String sandboxId;

    private String keyword;

    private String level;

    private String pageToken;

    private int pageSize = LogSearchConstants.DEFAULT_PAGE_SIZE;
}
