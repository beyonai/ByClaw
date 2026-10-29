package com.iwhalecloud.byai.manager.application.service.user;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.exception.BaseException;
import java.util.List;
import java.util.Set;

/** 个人资料自填选项，不能用于组织授权或岗位关系。 */
final class UserProfileOptions {
    /** 中文值是既有持久化契约；扩充时兼容旧值，错误提示仍通过国际化消息键返回。 */
    private static final Set<String> ROLES = Set.of(
        "产品 / 设计", "研发 / 测试", "市场 / 运营", "销售 / 商务", "客户服务",
        "管理 / 创业", "教育 / 科研", "项目 / 交付", "数据 / 分析", "算法 / 人工智能",
        "运维 / 安全", "人力 / 招聘", "行政 / 综合", "财务 / 审计", "法务 / 合规",
        "采购 / 供应链", "生产 / 质量", "医疗 / 健康", "学生 / 在校", "自由职业", "其他");

    private static final Set<String> INTERESTS = Set.of(
        "产品研发", "内容创作", "营销推广", "数据分析", "办公提效",
        "教育学习", "知识管理", "流程自动化", "智能体搭建", "代码开发",
        "软件测试", "产品设计", "市场调研", "销售支持", "客户服务",
        "项目管理", "人力招聘", "财务分析", "合同审阅", "会议纪要",
        "翻译写作", "图像设计", "音视频制作", "其他");

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
