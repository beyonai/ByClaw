package com.iwhalecloud.byai.manager.domain.tenant;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipRow;

@Service
public class TenantContextService {

    private final TenantMembershipMapper membershipMapper;
    private final ObjectMapper objectMapper;

    public TenantContextService(TenantMembershipMapper membershipMapper, ObjectMapper objectMapper) {
        this.membershipMapper = membershipMapper;
        this.objectMapper = objectMapper;
    }

    public TenantSwitchView switchTo(String enterpriseIdText) {
        long enterpriseId = parseEnterpriseId(enterpriseIdText);
        long userId = requireUserId();
        TenantMembershipRow membership = requireReadyMembership(userId, enterpriseId);
        return new TenantSwitchView(enterpriseIdText, membership.getRole());
    }

    public TenantRequestContext validate(String enterpriseIdText) {
        long enterpriseId = parseEnterpriseId(enterpriseIdText);
        long userId = requireUserId();
        TenantMembershipRow membership = requireReadyMembership(userId, enterpriseId);
        return new TenantRequestContext(userId, enterpriseId, membership.getRole());
    }

    private TenantMembershipRow requireReadyMembership(long userId, long enterpriseId) {
        TenantMembershipRow membership = membershipMapper.selectActiveMembership(userId, enterpriseId);
        if (membership == null) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "tenant membership required");
        }
        if (!"READY".equals(provisionState(membership))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant is not ready");
        }
        return membership;
    }

    private long requireUserId() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || userId <= 0) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "login required");
        }
        return userId;
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
            JsonNode state = objectMapper.readTree(row.getProvisionStateJson());
            if (state != null && state.path("status").isTextual()) {
                return state.path("status").asText();
            }
        }
        catch (Exception ignored) {
            // An invalid or missing state must never be presented as READY.
        }
        return "UNAVAILABLE";
    }
}
