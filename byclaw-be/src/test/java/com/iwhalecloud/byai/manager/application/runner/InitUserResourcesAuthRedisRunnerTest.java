package com.iwhalecloud.byai.manager.application.runner;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.application.service.auth.DigitalEmployeeGroupAuthorizationBackfillService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.test.util.ReflectionTestUtils;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class InitUserResourcesAuthRedisRunnerTest {
    private final InitUserResourcesAuthRedisRunner runner = new InitUserResourcesAuthRedisRunner();
    private final DigitalEmployeeGroupAuthorizationBackfillService backfill =
        mock(DigitalEmployeeGroupAuthorizationBackfillService.class);
    private final UserService users = mock(UserService.class);

    InitUserResourcesAuthRedisRunnerTest() {
        ReflectionTestUtils.setField(runner, "groupAuthorizationBackfillService", backfill);
        ReflectionTestUtils.setField(runner, "userService", users);
        ReflectionTestUtils.setField(runner, "batchSize", 100);
    }

    @Test
    void backfillsEvenWhenFullRedisInitializationIsDisabled() {
        ReflectionTestUtils.setField(runner, "loadUserAuthEnabled", false);

        runner.initialize();

        org.mockito.Mockito.verify(backfill).backfill();
        verifyNoInteractions(users);
    }

    @Test
    void backfillsBeforeReadingUsersForRedisInitialization() {
        ReflectionTestUtils.setField(runner, "loadUserAuthEnabled", true);
        when(users.selectList(any(Page.class), any(QueryWrapper.class))).thenReturn(List.of());

        runner.initialize();

        InOrder order = inOrder(backfill, users);
        order.verify(backfill).backfill();
        order.verify(users).selectList(any(Page.class), any(QueryWrapper.class));
    }
}
