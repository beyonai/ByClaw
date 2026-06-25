package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLaunchRouting;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;

@Service
public class SandboxCronPrewarmUserProvider {

    private static final int RECENT_LOGIN_DAYS = 90;

    private static final String CURSOR_KEY_PREFIX = "sandbox:cron-prewarm:user-cursor:";

    private final SandboxCronPrewarmProperties properties;

    private final UserService userService;

    private final SsSandboxRecordMapper sandboxRecordMapper;

    private final SandboxCronPrewarmCursorStore cursorStore;

    public SandboxCronPrewarmUserProvider(SandboxCronPrewarmProperties properties, UserService userService,
        SsSandboxRecordMapper sandboxRecordMapper, SandboxCronPrewarmCursorStore cursorStore) {
        this.properties = properties;
        this.userService = userService;
        this.sandboxRecordMapper = sandboxRecordMapper;
        this.cursorStore = cursorStore;
    }

    public List<String> listUserCodes() {
        return listUsers().stream()
            .map(SandboxCronPrewarmUserCandidate::getUserCode)
            .collect(Collectors.toList());
    }

    public List<SandboxCronPrewarmUserCandidate> listUsers() {
        int limit = properties.normalizedMaxUsersPerRun();
        SandboxLaunchRouting routing = resolvePrewarmRouting();
        if (StringUtils.isNotBlank(properties.getUserCodes())) {
            return Arrays.stream(properties.getUserCodes().split(","))
                .map(String::trim)
                .filter(StringUtils::isNotBlank)
                .distinct()
                .filter(userCode -> !hasRunningSandbox(userCode, routing))
                .map(userCode -> new SandboxCronPrewarmUserCandidate(null, userCode))
                .limit(limit)
                .collect(Collectors.toList());
        }

        Date recentLoginSince = Date.from(Instant.now().minus(RECENT_LOGIN_DAYS, ChronoUnit.DAYS));
        String cursorKey = cursorKey(routing);
        Long cursorUserId = normalizeCursor(cursorStore.getCursor(cursorKey));
        List<Users> users = new ArrayList<>(limit);
        users.addAll(listCandidateUsers(recentLoginSince, cursorUserId, routing, limit));
        if (users.size() < limit && cursorUserId != null && cursorUserId > 0L) {
            users.addAll(listCandidateUsers(recentLoginSince, 0L, routing, limit - users.size()));
        }
        return users.stream()
            .filter(user -> user != null && StringUtils.isNotBlank(user.getUserCode()))
            .map(user -> new SandboxCronPrewarmUserCandidate(user.getUserId(), user.getUserCode()))
            .collect(Collectors.toList());
    }

    public void markScanned(SandboxCronPrewarmUserCandidate user) {
        if (user == null || !user.isCursorTracked()) {
            return;
        }
        cursorStore.saveCursor(cursorKey(resolvePrewarmRouting()), user.getUserId());
    }

    private List<Users> listCandidateUsers(Date recentLoginSince, Long cursorUserId, SandboxLaunchRouting routing,
        int limit) {
        if (limit <= 0) {
            return List.of();
        }
        return userService.listCronPrewarmCandidateUsers(UserState.ACTIVE, recentLoginSince, cursorUserId,
            routing.getSandboxType(), routing.getEffectiveResourceId(), limit);
    }

    private SandboxLaunchRouting resolvePrewarmRouting() {
        String serviceKey = StringUtils.defaultIfBlank(properties.getDefaultServiceKey(),
            SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE);
        return new SandboxLaunchRouting(serviceKey, SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
    }

    private boolean hasRunningSandbox(String userCode, SandboxLaunchRouting routing) {
        return sandboxRecordMapper.selectRunningByUserAndResource(userCode, routing.getSandboxType(),
            routing.getEffectiveResourceId()) != null;
    }

    private Long normalizeCursor(Long cursorUserId) {
        if (cursorUserId == null || cursorUserId < 0L) {
            return 0L;
        }
        return cursorUserId;
    }

    private String cursorKey(SandboxLaunchRouting routing) {
        return CURSOR_KEY_PREFIX + sanitizeKeyPart(routing.getSandboxType()) + ":"
            + sanitizeKeyPart(String.valueOf(routing.getEffectiveResourceId())) + ":"
            + sanitizeKeyPart(StringUtils.defaultIfBlank(routing.getProfileKey(), "default"));
    }

    private String sanitizeKeyPart(String value) {
        return StringUtils.defaultString(value, "default").replaceAll("[^A-Za-z0-9_.:-]", "_");
    }
}
