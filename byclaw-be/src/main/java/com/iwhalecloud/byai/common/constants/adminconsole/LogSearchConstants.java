package com.iwhalecloud.byai.common.constants.adminconsole;

/**
 * 日志查询范围及分页限制。
 *
 * @author Codex
 * @date 2026-11-12
 */
public final class LogSearchConstants {
    public static final long MAX_WINDOW_SECONDS = 86400L;

    public static final int MIN_PAGE_SIZE = 1;

    public static final int MAX_PAGE_SIZE = 200;

    public static final int DEFAULT_PAGE_SIZE = 10;

    /**
     * 禁止实例化常量类。
     */
    private LogSearchConstants() {
    }
}
