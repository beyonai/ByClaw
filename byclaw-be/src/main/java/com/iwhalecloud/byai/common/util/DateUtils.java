package com.iwhalecloud.byai.common.util;

import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.Date;

/**
 * @author arthur.xu
 * @version 1.0
 * @date 2012-3-10
 */

public final class DateUtils {

    private DateUtils() {

    }

    public static final String DATE_FORMAT_MONTH = "yyyy-MM";

    public static final String DATE_FORMAT = "yyyy-MM-dd";

    public static final String COMPACT_DATE_FORMAT = "yyyyMMdd";

    public static final String COMPACT_DATE_TIME_FORMAT = "yyyyMMddHHmmss";

    public static final String DATE_TIME_FORMAT = "yyyy-MM-dd HH:mm:ss";

    public static final String ISO_TIME_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS";

    /**
     * 按指定格式将Date转换成字符串
     *
     * @param date 待格式化的日期，如果为null则返回空字符串
     * @param pattern 格式化模式，如：yyyy-MM-dd HH:mm:ss
     * @return 格式化后的日期字符串
     */
    public static String formatDate(Date date, String pattern) {
        if (date == null) {
            return null;
        }
        SimpleDateFormat dateFormatter = new SimpleDateFormat(pattern);
        return dateFormatter.format(date);
    }

    /**
     * 得到应用服务器当前日期，以默认格式显示。
     *
     * @return String
     */
    public static String getFormatedDate(Date date) {
        return formatDate(date, DATE_FORMAT);
    }

    /**
     * 将Date转换成统一的日期时间格式文本。
     *
     * @return String
     */
    public static String getFormatedDateTime(Date date) {
        return formatDate(date, DATE_TIME_FORMAT);
    }

    /**
     * 将时间串按照指定格式，格式化成Date。
     *
     * @param dateStr 字符串
     * @param pattern 格式类型，通过系统常量中定义，如：CapConstants.DATE_FORMAT_8
     * @return Date
     */
    public static Date parseStrToDate(String dateStr, String pattern) {
        if (StringUtil.isEmpty(dateStr)) {
            return null;
        }
        SimpleDateFormat dateFormator = new SimpleDateFormat(pattern);
        Date tDate = dateFormator.parse(dateStr, new ParsePosition(0));
        return tDate;
    }

    /**
     * 时间加减分钟
     * 
     * @param date 当前时间
     * @param minute 操作分钟数，为正数是为增加，为负数时为减
     * @return Date 操作后的时间
     */
    public static Date addMinute(Date date, int minute) {
        if (date == null) {
            date = new Date();
        }
        // 计算需要加减的毫秒数（1分钟 = 60000毫秒）
        long time = date.getTime() + minute * 60 * 1000L;
        // 创建并返回新的日期对象
        return new Date(time);
    }

    /**
     * 将时间串按照指定格式，格式化成Date,自适应ISO格式时间处理和默认格式
     *
     * @param dateStr 时间字符串
     * @return Date
     */
    public static Date convertStrToDate(String dateStr) {

        if (StringUtil.isEmpty(dateStr)) {
            return null;
        }

        if (dateStr.contains("T")) {
            return parseStrToDate(dateStr, ISO_TIME_FORMAT);
        }
        else {
            return parseStrToDate(dateStr, DATE_TIME_FORMAT);
        }

    }

}
