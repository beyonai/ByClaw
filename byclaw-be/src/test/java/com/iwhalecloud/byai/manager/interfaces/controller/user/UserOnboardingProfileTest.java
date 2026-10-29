package com.iwhalecloud.byai.manager.interfaces.controller.user;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.alibaba.fastjson.JSON;
import java.util.List;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.user.UserAvatarApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserProfileApplicationService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.manager.entity.customer.ByaiCustomerLeads;
import com.iwhalecloud.byai.manager.mapper.customer.ByaiCustomerLeadsMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class UserOnboardingProfileTest extends I18nTestSupport {
    @AfterEach
    void clearLogin() {
        CurrentUserHolder.clearLoginInfo();
    }

    @ParameterizedTest
    @CsvSource({
        "产品 / 设计,内容创作,数据分析",
        "财务 / 审计,财务分析,合同审阅"
    })
    @SuppressWarnings({"unchecked", "rawtypes"})
    void savesProfileFieldsOnCurrentUserAndReturnsThem(String role, String firstInterest, String secondInterest)
        throws Exception {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), Users.class);
        UsersMapper mapper = mock(UsersMapper.class);
        Users user = new Users();
        user.setUserId(42L);
        user.setState("A");
        when(mapper.selectById(42L)).thenReturn(user);
        when(mapper.update(isNull(), any())).thenReturn(1);
        ByaiCustomerLeadsMapper leads = mock(ByaiCustomerLeadsMapper.class);
        SequenceService sequence = mock(SequenceService.class);
        when(sequence.nextVal()).thenReturn(9001L);
        when(leads.insertProfile(any())).thenReturn(1);
        LoginInfo login = new LoginInfo();
        login.setUserId(42L);
        CurrentUserHolder.setLoginInfo(login);
        UserController controller = new UserController();
        ReflectionTestUtils.setField(controller, "userProfileApplicationService",
            new UserProfileApplicationService(mapper, mock(UserAvatarApplicationService.class), leads, sequence));

        MockMvcBuilders.standaloneSetup(controller).build()
            .perform(multipart("/system/user/updateProfile")
                .param("userName", "吴杰").param("companyName", "鲸智科技")
                .param("profileRole", role)
                .param("profileInterests", JSON.toJSONString(List.of(firstInterest, secondInterest))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.companyName").value("鲸智科技"))
            .andExpect(jsonPath("$.data.profileRole").value(role))
            .andExpect(jsonPath("$.data.profileInterests[0]").value(firstInterest))
            .andExpect(jsonPath("$.data.profileInterests[1]").value(secondInterest));

        ArgumentCaptor<LambdaUpdateWrapper<Users>> update = ArgumentCaptor.forClass((Class) LambdaUpdateWrapper.class);
        verify(mapper).update(isNull(), update.capture());
        assertThat(update.getValue().getSqlSet()).doesNotContain("company_name=", "profile_role=", "profile_interests=");
        ArgumentCaptor<ByaiCustomerLeads> saved = ArgumentCaptor.forClass(ByaiCustomerLeads.class);
        verify(leads).insertProfile(saved.capture());
        assertThat(saved.getValue().getUserId()).isEqualTo(42L);
        assertThat(saved.getValue().getContactName()).isEqualTo("吴杰");
        assertThat(saved.getValue().getCompanyName()).isEqualTo("鲸智科技");
        assertThat(saved.getValue().getProfileRole()).isEqualTo(role);
        assertThat(JSON.parseArray(saved.getValue().getProfileInterests(), String.class))
            .containsExactly(firstInterest, secondInterest);
        assertThat(update.getValue().getSqlSegment()).contains("user_id =", "state =");
        assertThat(login.getUserName()).isEqualTo("吴杰");
        assertThat(login.getIsRetented()).isTrue();
    }
}
