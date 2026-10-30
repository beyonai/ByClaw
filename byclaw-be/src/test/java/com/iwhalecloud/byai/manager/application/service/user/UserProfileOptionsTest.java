package com.iwhalecloud.byai.manager.application.service.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.manager.dto.users.UserProfileUpdateRequest;
import jakarta.validation.Validation;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class UserProfileOptionsTest extends I18nTestSupport {

    /** 完整选项同时覆盖白名单及 DTO 长度限制，防止用户多选后才发现不能保存。 */
    private static final List<String> ALL_INTERESTS = List.of(
        "产品研发", "内容创作", "营销推广", "数据分析", "办公提效", "教育学习", "知识管理",
        "流程自动化", "智能体搭建", "代码开发", "软件测试", "产品设计", "市场调研", "销售支持",
        "客户服务", "项目管理", "人力招聘", "财务分析", "合同审阅", "会议纪要", "翻译写作",
        "图像设计", "音视频制作", "其他");

    @ParameterizedTest
    @ValueSource(strings = {
        "产品 / 设计", "研发 / 测试", "市场 / 运营", "销售 / 商务", "客户服务", "管理 / 创业",
        "教育 / 科研", "项目 / 交付", "数据 / 分析", "算法 / 人工智能", "运维 / 安全", "人力 / 招聘",
        "行政 / 综合", "财务 / 审计", "法务 / 合规", "采购 / 供应链", "生产 / 质量", "医疗 / 健康",
        "学生 / 在校", "自由职业", "其他"
    })
    void acceptsExistingAndExpandedRoles(String role) {
        assertThat(UserProfileOptions.role(" " + role + " ")).isEqualTo(role);
    }

    @Test
    void acceptsAllInterestsWithinTheExistingRequestLimit() {
        String interests = JSON.toJSONString(ALL_INTERESTS);
        UserProfileUpdateRequest request = new UserProfileUpdateRequest("测试用户", null);
        request.setCompanyName("个人");
        request.setProfileRole("算法 / 人工智能");
        request.setProfileInterests(interests);
        assertThat(UserProfileOptions.interests(interests)).containsExactlyElementsOf(ALL_INTERESTS);
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            assertThat(factory.getValidator().validate(request)).isEmpty();
        }
    }

    @Test
    void keepsOptionalClearingAndDeduplication() {
        assertThat(UserProfileOptions.role(null)).isNull();
        assertThat(UserProfileOptions.role(" ")).isEmpty();
        assertThat(UserProfileOptions.interests(null)).isEmpty();
        assertThat(UserProfileOptions.interests("[]")).isEmpty();
        assertThat(UserProfileOptions.interests(JSON.toJSONString(List.of("智能体搭建", "智能体搭建", "会议纪要"))))
            .containsExactly("智能体搭建", "会议纪要");
    }

    @Test
    void rejectsUnlistedValuesAndTooManySelections() {
        assertThatThrownBy(() -> UserProfileOptions.role("未定义岗位")).isInstanceOf(BaseException.class);
        assertThatThrownBy(() -> UserProfileOptions.interests("[\"未定义领域\"]"))
            .isInstanceOf(BaseException.class);
        String oversized = JSON.toJSONString(java.util.Collections.nCopies(25, "智能体搭建"));
        assertThatThrownBy(() -> UserProfileOptions.interests(oversized)).isInstanceOf(BaseException.class);
    }
}
