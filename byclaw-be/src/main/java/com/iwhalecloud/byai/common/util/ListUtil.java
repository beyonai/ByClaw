package com.iwhalecloud.byai.common.util;

import java.util.Collection;

/**
 * @author he.duming
 * @date 2025-04-29 02:11:28
 * @description TODO
 */
public final class ListUtil {

    private ListUtil() {

    }

    /**
     * 判断集合是否为空集
     * 
     * @param list 集合信息
     * @return boolean
     */
    public static boolean isNotEmpty(Collection<?> list) {
        if (list != null && !list.isEmpty()) {
            return true;
        }
        return false;
    }

    /**
     * 判断信是否为空
     * 
     * @param list 集合信息
     * @return boolean
     */
    public static boolean isEmpty(Collection<?> list) {
        return !isNotEmpty(list);
    }
}
