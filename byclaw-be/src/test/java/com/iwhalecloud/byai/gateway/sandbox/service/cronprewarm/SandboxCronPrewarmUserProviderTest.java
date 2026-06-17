package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.List;
import java.util.Locale;

import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;

class SandboxCronPrewarmUserProviderTest {

    private final UserService userService = mock(UserService.class);

    @BeforeAll
    static void initMybatisPlusTableInfo() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), Users.class);
    }

    @Test
    @SuppressWarnings({
        "rawtypes", "unchecked"
    })
    void listUserCodesQueriesUsersLoggedInDuringLast90Days() {
        SandboxCronPrewarmProperties properties = new SandboxCronPrewarmProperties();
        properties.setMaxUsersPerRun(50);
        SandboxCronPrewarmUserProvider provider = new SandboxCronPrewarmUserProvider(properties, userService);
        when(userService.selectList(any(), any())).thenReturn(List.of(user("alice"), user(""), user("alice"),
            user("bob")));

        Instant lowerBound = Instant.now().minus(90, ChronoUnit.DAYS).minusSeconds(1);
        List<String> userCodes = provider.listUserCodes();
        Instant upperBound = Instant.now().minus(90, ChronoUnit.DAYS).plusSeconds(1);

        assertThat(userCodes).containsExactly("alice", "bob");

        ArgumentCaptor<IPage> pageCaptor = ArgumentCaptor.forClass(IPage.class);
        ArgumentCaptor<Wrapper> wrapperCaptor = ArgumentCaptor.forClass(Wrapper.class);
        verify(userService).selectList(pageCaptor.capture(), wrapperCaptor.capture());

        Page<Users> page = (Page<Users>) pageCaptor.getValue();
        assertThat(page.getCurrent()).isEqualTo(1);
        assertThat(page.getSize()).isEqualTo(50);

        LambdaQueryWrapper<Users> queryWrapper = (LambdaQueryWrapper<Users>) wrapperCaptor.getValue();
        String sqlSegment = queryWrapper.getSqlSegment().toLowerCase(Locale.ROOT);
        assertThat(sqlSegment).contains("last_login_date is not null");
        assertThat(sqlSegment).contains("last_login_date >=");

        Date recentLoginSince = queryWrapper.getParamNameValuePairs().values().stream()
            .filter(Date.class::isInstance)
            .map(Date.class::cast)
            .findFirst()
            .orElseThrow();
        assertThat(recentLoginSince.toInstant()).isBetween(lowerBound, upperBound);
    }

    private Users user(String userCode) {
        Users user = new Users();
        user.setUserCode(userCode);
        return user;
    }
}
