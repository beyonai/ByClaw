package com.iwhalecloud.byai.common.util;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * @author 字符串处理的公共类
 */
public final class StringUtil {

    private StringUtil() {

    }

    /**
     * 判断字符串是否为不为空
     *
     * @param string 字符串
     * @return boolean
     */
    public static boolean isNotEmpty(String string) {
        return string != null && !string.trim().isEmpty();
    }

    /**
     * 判断字符串是否为空
     *
     * @param string 字符串
     * @return boolean
     */
    public static boolean isEmpty(String string) {
        return !isNotEmpty(string);
    }

    /**
     * 字符串的分隔
     *
     * @param seperator 分隔符
     * @param strings 数组
     * @return String
     */
    public static String join(String[] strings, String seperator) {
        if (strings == null) {
            return "";
        }
        int length = strings.length;
        if (length == 0) {
            return "";
        }
        StringBuilder buf = new StringBuilder(length * strings[0].length()).append(strings[0]);
        for (int i = 1; i < length; i++) {
            buf.append(seperator).append(strings[i]);
        }
        return buf.toString();
    }

    /**
     * 字符串切割成数组
     * 
     * @param str 字符串
     * @return List
     */
    public static List<Long> splitLong(String str) {
        String[] splitArr = str.split(",");
        List<Long> resourceIds = new ArrayList<>(10);
        for (String splitStr : splitArr) {
            if (StringUtil.isEmpty(splitStr)) {
                continue;
            }
            resourceIds.add(Long.parseLong(splitStr));
        }
        return resourceIds;
    }

    /**
     * 字符串切割成数组
     * 
     * @param str 字符串
     * @param seperator 分隔符
     * @return List
     */
    public static List<String> splitStr(String str, String seperator) {
        if (isEmpty(str)) {
            return Collections.emptyList();
        }
        String[] splitArr = str.split(seperator);
        return Arrays.asList(splitArr);
    }

    /**
     * 校验是否为数字
     *
     * @param num 数字字符串
     * @return boolean
     */
    public static boolean isNum(String num) {

        if (isEmpty(num)) {
            return false;
        }
        if (num.startsWith("-")) {
            return isNum(num.substring(1));
        }

        Pattern pattern = Pattern.compile("^\\d+$");
        Matcher isNum = pattern.matcher(num);
        return isNum.matches();
    }

    /**
     * 将字符串切割成Long数组返回
     *
     * @param str 切割的字符串
     * @param separator 分隔符
     * @return List<Long>
     */
    public static List<Long> splitLong(String str, String separator) {
        if (isEmpty(str) || isEmpty(separator)) {
            return Collections.emptyList();
        }

        List<Long> resultList = new ArrayList<>(10);
        String[] splitResult = str.split(separator);
        for (String orgIdStr : splitResult) {
            resultList.add(Long.parseLong(orgIdStr));
        }
        return resultList;
    }

    /**
     * 截取字符串
     *
     * @param str 字符串
     * @param separator 分隔符
     * @return String
     */
    public static String substringBefore(String str, String separator) {
        if (!isEmpty(str) && separator != null) {
            if (separator.isEmpty()) {
                return "";
            }
            else {
                int pos = str.indexOf(separator);
                return pos == -1 ? str : str.substring(0, pos);
            }
        }
        else {
            return str;
        }
    }

    /**
     * 获取文件名的后缀名（带小数点，统一转小写，无后缀返回空字符串）
     *
     * @param fileName 文件名（如：Test.JPG、report.v2.pdf、readme）
     * @return 带小数点的小写后缀（如：.jpg、.pdf），无后缀/异常情况返回空字符串
     */
    public static String getFileSuffix(String fileName) {
        // 1. 空值/空字符串校验
        if (fileName == null || fileName.trim().isEmpty()) {
            return "";
        }
        // 2. 去除文件名前后空格
        String cleanFileName = fileName.trim();
        // 3. 找到最后一个点的位置
        int lastDotIndex = cleanFileName.lastIndexOf(".");
        // 4. 处理边界情况：无点、点在开头/结尾 → 返回空
        if (lastDotIndex == -1 || lastDotIndex == 0 || lastDotIndex == cleanFileName.length() - 1) {
            return "";
        }
        // 5. 截取带小数点的后缀并转小写（核心修改：从lastDotIndex开始截取，而非lastDotIndex+1）
        return cleanFileName.substring(lastDotIndex).toLowerCase();
    }

}
