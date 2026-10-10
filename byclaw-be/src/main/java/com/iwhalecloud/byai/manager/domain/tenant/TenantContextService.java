package com.iwhalecloud.byai.manager.domain.tenant;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.util.RuntimeEnvironment;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.ProvisionState;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipRow;

@Service
public class TenantContextService {

    private static final Logger log = LoggerFactory.getLogger(TenantContextService.class);

    private static final Duration CONTEXT_TTL = Duration.ofMinutes(30);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int CONTEXT_VERSION = 1;

    private final TenantMembershipMapper membershipMapper;
    private final ObjectMapper objectMapper;
    private final StringRedisTemplate redisTemplate;

    public TenantContextService(TenantMembershipMapper membershipMapper, ObjectMapper objectMapper,
                                StringRedisTemplate redisTemplate) {
        this.membershipMapper = membershipMapper;
        this.objectMapper = objectMapper;
        this.redisTemplate = redisTemplate;
    }

    public TenantSwitchView switchTo(String enterpriseIdText) {
        long enterpriseId = parseEnterpriseId(enterpriseIdText);
        LoginInfo login = requireLogin();
        long userId = login.getUserId();
        log.info("tenant switch requested: enterpriseId={}, userId={}, hasSession={}", enterpriseId, userId,
            login.getSessionId() != null && !login.getSessionId().isBlank());
        TenantMembershipRow membership = requireReadyMembership(userId, enterpriseId);
        log.info("tenant switch membership ready: enterpriseId={}, userId={}", enterpriseId, userId);
        if (login.getSessionId() == null || login.getSessionId().isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "login session required");
        }
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expiresAt = Instant.now().plus(CONTEXT_TTL);
        try {
            redisTemplate.opsForValue().set(tokenKey(token), objectMapper.writeValueAsString(
                new TokenBinding(userId, login.getSessionId(), enterpriseId, CONTEXT_VERSION, expiresAt.toString())),
                CONTEXT_TTL);
        }
        catch (Exception e) {
            log.warn("tenant switch context storage failed: enterpriseId={}, userId={}", enterpriseId, userId, e);
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "tenant context unavailable");
        }
        log.info("tenant switch context issued: enterpriseId={}, userId={}", enterpriseId, userId);
        return new TenantSwitchView(enterpriseIdText, membership.getRole(), token,
            expiresAt.toString(), CONTEXT_VERSION);
    }

    public TenantRequestContext validate(String enterpriseIdText) {
        long enterpriseId = parseEnterpriseId(enterpriseIdText);
        long userId = requireUserId();
        TenantMembershipRow membership = requireReadyMembership(userId, enterpriseId);
        return new TenantRequestContext(userId, enterpriseId, membership.getRole());
    }

    public TenantRequestContext validate(String enterpriseIdText, String contextToken) {
        long enterpriseId = parseEnterpriseId(enterpriseIdText);
        LoginInfo login = requireLogin();
        if (contextToken == null || !contextToken.matches("[A-Za-z0-9_-]{43}")) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "tenant context token required");
        }
        TokenBinding binding;
        try {
            String value = redisTemplate.opsForValue().get(tokenKey(contextToken));
            binding = value == null ? null : objectMapper.readValue(value, TokenBinding.class);
        }
        catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid tenant context");
        }
        boolean valid;
        try {
            valid = binding != null && binding.userId() == login.getUserId()
                && binding.enterpriseId() == enterpriseId && binding.version() == CONTEXT_VERSION
                && binding.sessionId() != null && binding.sessionId().equals(login.getSessionId())
                && binding.expiresAt() != null && Instant.parse(binding.expiresAt()).isAfter(Instant.now());
        }
        catch (RuntimeException e) {
            valid = false;
        }
        if (!valid) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid tenant context");
        }
        TenantMembershipRow membership = requireReadyMembership(login.getUserId(), enterpriseId);
        return new TenantRequestContext(login.getUserId(), enterpriseId, membership.getRole());
    }

    private TenantMembershipRow requireReadyMembership(long userId, long enterpriseId) {
        TenantMembershipRow membership = membershipMapper.selectActiveMembership(userId, enterpriseId);
        if (membership == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "tenant membership required");
        }
        if (RuntimeEnvironment.isDevelopment()) {
            return membership;
        }
        if (!"READY".equals(provisionState(membership))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant is not ready");
        }
        return membership;
    }

    private long requireUserId() {
        return requireLogin().getUserId();
    }

    private LoginInfo requireLogin() {
        LoginInfo login = CurrentUserHolder.getLoginInfo();
        if (login == null || login.getUserId() == null || login.getUserId() <= 0) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "login required");
        }
        return login;
    }

    private String tokenKey(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return "tenant:context:" + HexFormat.of().formatHex(digest);
        }
        catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private record TokenBinding(long userId, String sessionId, long enterpriseId,
                                int version, String expiresAt) {
    }

    private long parseEnterpriseId(String text) {
        if (text == null || !text.matches("[1-9][0-9]*")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid enterprise ID");
        }
        try {
            return Long.parseLong(text);
        }
        catch (NumberFormatException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid enterprise ID");
        }
    }

    public List<TenantAvailableView> available() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || userId <= 0) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "login required");
        }
        return membershipMapper.selectAvailableForUser(userId).stream()
            .map(row -> new TenantAvailableView(row.getEnterpriseId(), row.getEnterpriseName(),
                row.getRole(), provisionState(row)))
            .toList();
    }

    private String provisionState(TenantMembershipRow row) {
        try {
            ProvisionState state = objectMapper.readValue(row.getProvisionStateJson(), ProvisionState.class);
            if (state != null && state.status() != null) {
                return state.status();
            }
        }
        catch (Exception ignored) {
            // An invalid or missing state must never be presented as READY.
        }
        return "UNAVAILABLE";
    }
}
