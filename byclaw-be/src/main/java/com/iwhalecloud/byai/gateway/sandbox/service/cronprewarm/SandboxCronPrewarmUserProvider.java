package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;

@Service
public class SandboxCronPrewarmUserProvider {

    private static final int RECENT_LOGIN_DAYS = 90;

    private final SandboxCronPrewarmProperties properties;

    private final UserService userService;

    public SandboxCronPrewarmUserProvider(SandboxCronPrewarmProperties properties, UserService userService) {
        this.properties = properties;
        this.userService = userService;
    }

    public List<String> listUserCodes() {
        int limit = properties.normalizedMaxUsersPerRun();
        if (StringUtils.isNotBlank(properties.getUserCodes())) {
            return Arrays.stream(properties.getUserCodes().split(","))
                .map(String::trim)
                .filter(StringUtils::isNotBlank)
                .distinct()
                .limit(limit)
                .collect(Collectors.toList());
        }

        LambdaQueryWrapper<Users> queryWrapper = new LambdaQueryWrapper<>();
        Date recentLoginSince = Date.from(Instant.now().minus(RECENT_LOGIN_DAYS, ChronoUnit.DAYS));
        queryWrapper.eq(Users::getState, UserState.ACTIVE)
            .isNotNull(Users::getUserCode)
            .isNotNull(Users::getLastLoginDate)
            .ge(Users::getLastLoginDate, recentLoginSince)
            .orderByAsc(Users::getUserId);
        Page<Users> page = new Page<>(1, limit, false);
        return userService.selectList(page, queryWrapper)
            .stream()
            .map(Users::getUserCode)
            .filter(StringUtils::isNotBlank)
            .distinct()
            .collect(Collectors.toList());
    }
}
