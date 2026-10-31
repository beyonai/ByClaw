package com.iwhalecloud.byai.manager.domain.tenant;

import java.util.List;

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

    private final TenantMembershipMapper membershipMapper;
    private final ObjectMapper objectMapper;
    private final TenantModeService tenantModes;

    public TenantContextService(TenantMembershipMapper membershipMapper, ObjectMapper objectMapper,
                                TenantModeService tenantModes) {
        this.membershipMapper = membershipMapper;
        this.objectMapper = objectMapper;
        this.tenantModes = tenantModes;
    }

    /** Validates a browser tenant selection and returns the role without creating a token. */
    public TenantSwitchView switchTo(String enterpriseIdText) {
        long enterpriseId = parseEnterpriseId(enterpriseIdText);
        LoginInfo login = requireLogin();
        long userId = login.getUserId();
        log.info("tenant switch requested: enterpriseId={}, userId={}", enterpriseId, userId);
        TenantMembershipRow membership = requireReadyMembership(userId, enterpriseId);
        log.info("tenant switch membership ready: enterpriseId={}, userId={}", enterpriseId, userId);
        return new TenantSwitchView(enterpriseIdText, membership.getRole());
    }

    public TenantRequestContext validate(String enterpriseIdText) {
        long enterpriseId = parseEnterpriseId(enterpriseIdText);
        return validate(requireUserId(), enterpriseId);
    }

    /** Validates an explicit authenticated user and enterprise pair. */
    public TenantRequestContext validate(long userId, long enterpriseId) {
        LoginInfo login = requireLogin();
        if (userId <= 0 || login.getUserId() == null || login.getUserId() != userId) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "tenant.login.required");
        }
        TenantMembershipRow membership = requireReadyMembership(userId, enterpriseId);
        return new TenantRequestContext(userId, enterpriseId, membership.getRole());
    }

    private TenantMembershipRow requireReadyMembership(long userId, long enterpriseId) {
        TenantMembershipRow membership = membershipMapper.selectActiveMembership(userId, enterpriseId);
        if (membership == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "tenant.membership.required");
        }
        if (RuntimeEnvironment.isDevelopment()) {
            return membership;
        }
        if (!tenantModes.isTrialTenant(enterpriseId) && !"READY".equals(provisionState(membership))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant.notReady");
        }
        return membership;
    }

    private long requireUserId() {
        return requireLogin().getUserId();
    }

    private LoginInfo requireLogin() {
        LoginInfo login = CurrentUserHolder.getLoginInfo();
        if (login == null || login.getUserId() == null || login.getUserId() <= 0) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "tenant.login.required");
        }
        return login;
    }

    private long parseEnterpriseId(String text) {
        if (text == null || !text.matches("[1-9][0-9]*")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant.enterpriseId.invalid");
        }
        try {
            return Long.parseLong(text);
        }
        catch (NumberFormatException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant.enterpriseId.invalid");
        }
    }

    public List<TenantAvailableView> available() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || userId <= 0) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "tenant.login.required");
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
