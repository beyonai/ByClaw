package com.iwhalecloud.byai.common.util;

import com.alibaba.fastjson.JSON;
import java.util.Collections;
import java.util.List;

/**
 * JSON工具类 提供JSON字符串与Java对象之间的转换功能
 * 
 * @author system
 * @version 1.0
 * @since 2024-01-01
 */
public final class JsonUtil {

    private JsonUtil() {
        // 私有化构造器
    }

    /**
     * 将Java对象转换为JSON字符串
     * 
     * @param obj 待转换的Java对象，可以为null
     * @return JSON字符串，如果输入对象为null则返回"null"
     */
    public static String toJSONString(Object obj) {
        return JSON.toJSONString(obj);
    }

    /**
     * 将JSON字符串解析为指定类型的Java对象
     * 
     * @param <T> 目标对象类型
     * @param json JSON字符串，如果为空或null则返回null
     * @param clazz 目标对象的Class类型
     * @return 解析后的Java对象，如果JSON字符串为空则返回null
     */
    public static <T> T parseObject(String json, Class<T> clazz) {
        if (StringUtil.isNotEmpty(json)) {
            return JSON.parseObject(json, clazz);
        }
        return null;
    }

    /**
     * 将JSON数组字符串解析为指定类型的Java对象列表
     * 
     * @param <T> 目标对象类型
     * @param jsonArray JSON数组字符串，如果为空或null则返回空列表
     * @param clazz 目标对象的Class类型
     * @return 解析后的Java对象列表，如果JSON数组字符串为空则返回空列表
     */
    public static <T> List<T> parseArray(String jsonArray, Class<T> clazz) {
        if (StringUtil.isNotEmpty(jsonArray) && !"null".equalsIgnoreCase(jsonArray)) {
            return JSON.parseArray(jsonArray, clazz);
        }
        return Collections.emptyList();
    }

}
