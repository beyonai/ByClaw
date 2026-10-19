package com.iwhalecloud.byai.manager.application.service.user;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.exception.BaseException;
import java.util.List;
import java.util.Set;

/** 个人资料自填选项，不能用于组织授权或岗位关系。 */
final class UserProfileOptions {
    private static final Set<String> ROLES = Set.of(
        "产品 / 设计", "研发 / 测试", "市场 / 运营", "销售 / 商务", "客户服务",
        "管理 / 创业", "教育 / 科研", "其他");
    private static final Set<String> INTERESTS = Set.of(
        "产品研发", "内容创作", "营销推广", "数据分析", "办公提效",
        "教育学习", "知识管理", "其他");

    private UserProfileOptions() {
    }

    static String role(String value) {
        if (value == null) return null;
        String role = value.trim();
        if (!role.isEmpty() && !ROLES.contains(role)) {
            throw new BaseException("profile.role.invalid");
        }
        return role;
    }

    static List<String> interests(String value) {
        if (value == null) return List.of();
        try {
            List<String> interests = JSON.parseArray(value, String.class);
            if (interests == null || interests.size() > INTERESTS.size()
                || interests.stream().anyMatch(item -> item == null || !INTERESTS.contains(item))) {
                throw new IllegalArgumentException(I18nUtil.get("user.profile.interestsInvalid"));
            }
            return interests.stream().distinct().toList();
        }
        catch (Exception exception) {
            throw new BaseException("profile.interests.invalid");
        }
    }
}
