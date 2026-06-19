package com.iwhalecloud.byai.state.application.service.filebrowser;

import java.util.Locale;

import org.apache.commons.lang3.StringUtils;

/**
 * 文件浏览器模糊搜索匹配器。
 * 支持忽略大小写、空格和常见分隔符，也支持关键词字符按顺序散列匹配。
 *
 * @author qin.guoquan
 * @date 2026-06-17 22:38:38
 */
final class FileBrowserSearchMatcher {

    private FileBrowserSearchMatcher() {
    }

    static boolean matches(String name, String path, String keyword) {
        String normalizedKeyword = normalize(keyword);
        if (StringUtils.isBlank(normalizedKeyword)) {
            return false;
        }
        String normalizedCandidate = normalize(StringUtils.defaultString(name) + " " + StringUtils.defaultString(path));
        if (StringUtils.isBlank(normalizedCandidate)) {
            return false;
        }
        if (normalizedCandidate.contains(normalizedKeyword)) {
            return true;
        }
        for (String token : StringUtils.defaultString(keyword).trim().split("\\s+")) {
            String normalizedToken = normalize(token);
            if (StringUtils.isBlank(normalizedToken)) {
                continue;
            }
            if (!normalizedCandidate.contains(normalizedToken) && !isSubsequence(normalizedCandidate, normalizedToken)) {
                return false;
            }
        }
        return true;
    }

    private static String normalize(String value) {
        String lowerValue = StringUtils.defaultString(value).toLowerCase(Locale.ROOT);
        StringBuilder builder = new StringBuilder(lowerValue.length());
        for (int i = 0; i < lowerValue.length(); i++) {
            char ch = lowerValue.charAt(i);
            if (Character.isLetterOrDigit(ch)) {
                builder.append(ch);
            }
        }
        return builder.toString();
    }

    private static boolean isSubsequence(String candidate, String keyword) {
        int keywordIndex = 0;
        for (int i = 0; i < candidate.length() && keywordIndex < keyword.length(); i++) {
            if (candidate.charAt(i) == keyword.charAt(keywordIndex)) {
                keywordIndex++;
            }
        }
        return keywordIndex == keyword.length();
    }
}
