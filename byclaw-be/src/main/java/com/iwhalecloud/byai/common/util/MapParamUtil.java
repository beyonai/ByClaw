package com.iwhalecloud.byai.common.util;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.beans.BeanInfo;
import java.beans.Introspector;
import java.beans.PropertyDescriptor;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 提取MAP值工具类，安全提取
 */
public final class MapParamUtil {

    private static final Logger logger = LoggerFactory.getLogger(MapParamUtil.class);


    private MapParamUtil() {
    }

    /**
     * MAP 类型转换对象
     *
     * @param sourceMap
     * @param beanClass
     * @param <T>
     * @return
     */
    public static <T> T mapToObject(Map<String, Object> sourceMap, Class<T> beanClass) {
        try {
            if (sourceMap == null || beanClass == null) {
                return null;
            }
            // 反射创建对象
            T obj = beanClass.newInstance();
            // 给对象设置属性
            setProperty(sourceMap, obj);

            return (T) obj;
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
        return null;
    }

    /**
     * 对象转MAP
     *
     * @param input 输入对象
     * @return Map
     */
    public static Map<String, Object> objectToMap(Object input) {
        Map<String, Object> result = new HashMap<String, Object>();
        if (input == null) {
            return result;
        }
        Field[] fields = input.getClass().getDeclaredFields();
        for (Field field : fields) {
            try {
                field.setAccessible(true);
                Object value = field.get(input);
                result.put(field.getName(), value);
            }
            catch (Exception e) {
                logger.error(e.getMessage(), e);
            }
        }
        return result;
    }

    /**
     * 针对有父类的对象转map
     *
     * @param obj 对旬
     * @return Map
     */
    public static Map<String, Object> objectToMapWithParent(Object obj) {
        if (obj == null) {
            return null;
        }

        Map<String, Object> map = new HashMap<String, Object>(20);
        BeanInfo beanInfo;
        try {
            beanInfo = Introspector.getBeanInfo(obj.getClass());
            PropertyDescriptor[] propertyDescriptors = beanInfo.getPropertyDescriptors();
            for (PropertyDescriptor property : propertyDescriptors) {
                String key = property.getName();
                if (!"class".equals(key)) {
                    Method getter = property.getReadMethod();
                    Object value = getter.invoke(obj);
                    map.put(key, value);
                }
            }
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
        return map;
    }

    /**
     * 复制属性
     * 
     * @param sourceMap 来源
     * @param target 目标
     * @param ignoreFields 忽略的拷贝的字段属性
     */
    public static void copyProperties(Map<String, Object> sourceMap, Object target, String... ignoreFields) {
        setProperty(sourceMap, target, ignoreFields);
    }

    /**
     * 设置对象属性
     *
     * @param sourceMap 来源
     * @param obj 目标属性对象
     */
    private static void setProperty(Map<String, Object> sourceMap, Object obj, String... ignoreFields) {
        try {
            BeanInfo beanInfo = Introspector.getBeanInfo(obj.getClass(), Object.class);
            PropertyDescriptor[] pds = beanInfo.getPropertyDescriptors();
            List<String> ignoreList = Arrays.asList(ignoreFields);
            for (PropertyDescriptor pd : pds) {
                String key = pd.getName();
                Object value = sourceMap.get(key);
                String javaType = pd.getPropertyType().getName();

                // 如果值不空，不设置这个字段
                if (value == null || StringUtil.isEmpty(value.toString()) || ignoreList.contains(key)) {
                    continue;
                }

                if (javaType.contains("String")) {
                    pd.getWriteMethod().invoke(obj, String.valueOf(value));
                }
                else if (javaType.contains("Date")) {
                    // 如果是日期类型，特殊处理
                    processDataValue(obj, pd, value);
                }
                else if (javaType.contains("Long")) {
                    pd.getWriteMethod().invoke(obj, Long.parseLong(String.valueOf(value)));
                }
                else if (javaType.contains("Int")) {
                    pd.getWriteMethod().invoke(obj, Integer.parseInt(String.valueOf(value)));
                }
                else if (javaType.contains("Short")) {
                    pd.getWriteMethod().invoke(obj, Short.parseShort(String.valueOf(value)));
                }
                else if (javaType.contains("Double")) {
                    pd.getWriteMethod().invoke(obj, Double.parseDouble(String.valueOf(value)));
                }
                else {
                    pd.getWriteMethod().invoke(obj, value);
                }
            }
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
    }

    private static void processDataValue(Object obj, PropertyDescriptor pd, Object value)
        throws IllegalAccessException, InvocationTargetException {
        String stringDate = String.valueOf(value);

        if (stringDate.length() == 7) {
            // 长度为7的日期处理yyyy-MM
            Date date = DateUtils.parseStrToDate(stringDate, DateUtils.DATE_FORMAT_MONTH);
            pd.getWriteMethod().invoke(obj, date);
        }
        Date date;
        if (stringDate.length() == 10) {
            // 长度为10的日期处理yyyy-MM-dd
            date = DateUtils.parseStrToDate(stringDate, DateUtils.DATE_FORMAT);

        }
        else if (stringDate.length() == 13) {
            date = new Date(Long.parseLong(stringDate));
        }
        else {
            // 默认日期处理类yyyy-MM-dd HH:mm:ss
            date = DateUtils.parseStrToDate(stringDate, DateUtils.DATE_TIME_FORMAT);
        }
        pd.getWriteMethod().invoke(obj, date);
    }

    public static String getStringValue(Map paramMap, String key) {
        if (paramMap == null) {
            return "";
        }
        Object value = paramMap.get(key);
        if (value == null) {
            return "";
        }

        if (value instanceof String) {
            return (String) value;
        }
        else {
            return value.toString();
        }

    }

    /**
     * 获取整形值
     * 
     * @param paramMap 入参
     * @param key key
     * @return Integer
     */
    public static Integer getIntValue(Map paramMap, String key) {
        return getIntValue(paramMap, key, 0);
    }

    /***
     * @param paramMap 入参
     * @param key key
     * @param defaultValue 为空时的默认值
     * @return Integer
     */
    public static Integer getIntValue(Map paramMap, String key, int defaultValue) {
        Object value = paramMap.get(key);
        if (value == null) {
            return defaultValue;
        }

        if (value instanceof Integer) {
            return (Integer) value;
        }
        else if (value instanceof String) {
            return Integer.valueOf((String) value);
        }

        return defaultValue;
    }

    /**
     * 获取长整型值,如果没值，默认返回0
     * 
     * @param paramMap 集合
     * @param key key
     * @return Long
     */
    public static Long getLongValue(Map paramMap, String key) {
        return getLongValue(paramMap, key, 0L);
    }

    /**
     * 获取长整型值,如果没值，默认返回指定的值
     * 
     * @param paramMap 集合
     * @param key key
     * @param defaultVal 如果为空，返回默认值
     * @return Long
     */
    public static Long getLongValue(Map paramMap, String key, Long defaultVal) {
        String strValue = getStringValue(paramMap, key);
        if (StringUtil.isNotEmpty(strValue)) {
            return Long.parseLong(strValue);
        }
        else {
            return defaultVal;
        }
    }

    /**
     * 获取长整型值,如果没值，默认返回0
     *
     * @param paramMap 集合
     * @param key key
     * @return Long
     */
    public static Double getDoubleValue(Map paramMap, String key) {
        String strValue = getStringValue(paramMap, key);
        if (StringUtil.isNotEmpty(strValue)) {
            return Double.parseDouble(strValue);
        }
        return null;
    }

}