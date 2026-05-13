package com.iwhalecloud.byai.common.util;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.common.page.PageInfo;

import java.util.Collections;

/**
 * 分页转换工具
 */
public final class PageHelperUtil {

    private PageHelperUtil() {

    }

    /**
     * MyBatis-Plus {@link Page} 转为统一分页对象
     *
     * @param page 分页对象
     * @param <T>  泛型
     * @return PageInfo
     */
    public static <T> PageInfo<T> toPageInfo(Page<T> page) {
        PageInfo<T> result = new PageInfo<>();
        result.setList(page.getRecords());
        result.setTotal(page.getTotal());
        result.setTotalPages((int) page.getPages());
        result.setPageNum((int) page.getCurrent());
        result.setPageSize((int) page.getSize());
        return result;
    }

    /**
     * 返回空分页信息
     *
     * @param pageNum  当前页码
     * @param pageSize 页面大小
     * @param <T>      泛型
     * @return PageInfo
     */
    public static <T> PageInfo<T> emptyPage(Long pageNum, Long pageSize) {
        long pn = pageNum != null ? pageNum : 1L;
        long ps = pageSize != null ? pageSize : 10L;
        return emptyPage(pn, ps);
    }

    /**
     * 返回空分页信息
     *
     * @param pageNum  当前页码
     * @param pageSize 页面大小
     * @param <T>      泛型
     * @return PageInfo
     */
    public static <T> PageInfo<T> emptyPage(long pageNum, long pageSize) {
        PageInfo<T> result = new PageInfo<>();
        result.setTotal(0);
        result.setTotalPages(0);
        result.setPageNum((int) pageNum);
        result.setPageSize((int) pageSize);
        result.setList(Collections.emptyList());
        return result;
    }

    /**
     * PageHelper 的 {@link com.github.pagehelper.Page} 转为统一分页对象（内部使用 {@link #toPageInfo(com.github.pagehelper.PageInfo)}）
     *
     * @param page PageHelper 分页对象
     * @param <T>  泛型
     * @return PageInfo
     */
    public static <T> PageInfo<T> toPageInfo(com.github.pagehelper.Page<T> page) {
        return toPageInfo(page.toPageInfo());
    }

    /**
     * 将 com.github.pagehelper.PageInfo 转为统一分页对象
     *
     * @param pageHelperInfo PageHelper 的 PageInfo
     * @param <T>            泛型
     * @return PageInfo
     */
    public static <T> PageInfo<T> toPageInfo(com.github.pagehelper.PageInfo<T> pageHelperInfo) {
        PageInfo<T> result = new PageInfo<>();
        result.setList(pageHelperInfo.getList());
        result.setTotal(pageHelperInfo.getTotal());
        result.setTotalPages(pageHelperInfo.getPages());
        result.setPageNum(pageHelperInfo.getPageNum());
        result.setPageSize(pageHelperInfo.getPageSize());
        return result;
    }

}
