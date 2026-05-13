package com.iwhalecloud.byai.state.domain.file.service;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

/**
 * 页数检查结果
 * 
 * @author system
 */
public class PageCountResult {
    
    /**
     * 是否通过检查
     */
    private final boolean passed;
    
    /**
     * 实际页数
     */
    private final int pageCount;
    
    /**
     * 最大允许页数
     */
    private final int maxPages;
    
    /**
     * 构造函数
     * 
     * @param passed 是否通过检查
     * @param pageCount 实际页数
     * @param maxPages 最大允许页数
     */
    public PageCountResult(boolean passed, int pageCount, int maxPages) {
        this.passed = passed;
        this.pageCount = pageCount;
        this.maxPages = maxPages;
    }
    
    /**
     * 是否通过检查
     * 
     * @return true表示通过，false表示未通过
     */
    public boolean isPassed() {
        return passed;
    }
    
    /**
     * 获取实际页数
     * 
     * @return 实际页数
     */
    public int getPageCount() {
        return pageCount;
    }
    
    /**
     * 获取最大允许页数
     * 
     * @return 最大允许页数
     */
    public int getMaxPages() {
        return maxPages;
    }
    
    /**
     * 获取检查结果消息
     * 
     * @return 检查结果消息
     */
    public String getMessage() {
        if (passed) {
            return I18nUtil.get("document.page.count.check.passed.message", pageCount, maxPages);
        } else {
            return I18nUtil.get("document.page.count.check.exceeded.message", pageCount, maxPages);
        }
    }
}
