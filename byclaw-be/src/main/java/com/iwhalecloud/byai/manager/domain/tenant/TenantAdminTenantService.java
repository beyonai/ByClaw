package com.iwhalecloud.byai.manager.domain.tenant;

import java.util.List;
import java.util.Map;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantRow;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantPackageRow;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Platform administrator entry point for idempotent tenant reservation. */
@Service
public class TenantAdminTenantService {

    private final TenantAdminTenantMapper tenantMapper;
    private final SequenceService sequenceService;
    private final ObjectMapper objectMapper;

    public TenantAdminTenantService(TenantAdminTenantMapper tenantMapper, SequenceService sequenceService,
                                    ObjectMapper objectMapper) {
        this.tenantMapper = tenantMapper;
        this.sequenceService = sequenceService;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public List<TenantView> list(TenantListFilter filter) {
        requirePlatformAdmin();
        TenantListFilter query = filter == null ? new TenantListFilter(null, null, null, null, null) : filter;
        String name = query.name() == null ? null : query.name().trim();
        if (name != null && name.length() > 200) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant name filter is too long");
        }
        if (query.sortField() != null && !List.of("createdAt", "openedAt", "enterpriseName")
            .contains(query.sortField())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid tenant sort field");
        }
        if (query.sortOrder() != null && !List.of("asc", "desc").contains(query.sortOrder())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid tenant sort order");
        }
        LocalDateTime from = parseTime(query.createdFrom());
        LocalDateTime to = parseTime(query.createdTo());
        if (from != null && to != null && !from.isBefore(to)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid tenant creation time range");
        }
        return tenantMapper.selectTenants(name, from, to, query.sortField(), query.sortOrder())
            .stream().map(this::toView).toList();
    }

    private LocalDateTime parseTime(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return LocalDateTime.parse(value);
        }
        catch (DateTimeParseException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid tenant creation time", e);
        }
    }

    @Transactional(readOnly = true)
    public List<PackageView> packages() {
        requirePlatformAdmin();
        return tenantMapper.selectEnabledPackages().stream()
            .map(row -> new PackageView(row.getId(), row.getPackageName(), row.getPackageContent()))
            .toList();
    }

    @Transactional
    public TenantView create(String name, long packageId, String requestId) {
        requirePlatformAdmin();
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || userId <= 0) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "login required");
        }
        if (name == null || name.isBlank() || name.length() > 200 || !name.equals(name.trim())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid tenant name");
        }
        if (requestId == null || !requestId.matches("[a-zA-Z0-9_-]{8,64}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid request ID");
        }
        TenantPackageRow selectedPackage = tenantMapper.selectEnabledPackage(packageId);
        if (selectedPackage == null || !validPackage(selectedPackage.getPackageContent())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid tenant package");
        }

        TenantAdminTenantRow existing = tenantMapper.selectByRequestId(requestId);
        if (existing != null) {
            if (!userId.equals(existing.getCreatedBy()) || !name.equals(existing.getEnterpriseName())
                || !selectedPackage.getPackageName().equals(existing.getPackageName())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "request ID already used");
            }
            return toView(existing);
        }

        long enterpriseId = sequenceService.nextVal();
        String state = stateJson("RESERVED");
        tenantMapper.insertEnterprise(enterpriseId, name);
        insertConfig(enterpriseId, "PROVISION_REQUEST_ID", requestId);
        insertConfig(enterpriseId, "PACKAGE_SPEC_ID", Long.toString(packageId));
        insertConfig(enterpriseId, "PACKAGE_NAME_SNAPSHOT", selectedPackage.getPackageName());
        insertConfig(enterpriseId, "PACKAGE_CONTENT_SNAPSHOT", selectedPackage.getPackageContent());
        insertConfig(enterpriseId, "PROVISION_STATE", state);
        tenantMapper.insertOwner(sequenceService.nextVal(), enterpriseId, userId);
        return new TenantView(Long.toString(enterpriseId), name, selectedPackage.getPackageName(), "RESERVED",
            null, null, null);
    }

    private void insertConfig(long enterpriseId, String code, String value) {
        tenantMapper.insertConfig(sequenceService.nextVal(), enterpriseId, code, value);
    }

    private boolean validPackage(String json) {
        try {
            JsonNode content = objectMapper.readTree(json);
            return content.path("memberLimit").asInt() > 0
                && List.of("s", "m", "l").contains(content.path("profileKey").asText());
        }
        catch (Exception ignored) {
            return false;
        }
    }

    private String stateJson(String status) {
        try {
            return objectMapper.writeValueAsString(Map.of("status", status, "generation", 1, "fencingToken", 1));
        }
        catch (JsonProcessingException e) {
            throw new IllegalStateException("tenant provision state serialization failed", e);
        }
    }

    private TenantView toView(TenantAdminTenantRow row) {
        String status = "UNAVAILABLE";
        try {
            status = objectMapper.readTree(row.getProvisionStateJson()).path("status").asText("UNAVAILABLE");
        }
        catch (Exception ignored) {
            // Invalid persisted state never grants tenant access.
        }
        return new TenantView(Long.toString(row.getEnterpriseId()), row.getEnterpriseName(),
            row.getPackageName(), status, row.getCreatedAt(), row.getOpenedAt(), row.getFailureReason());
    }

    private void requirePlatformAdmin() {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "platform administrator required");
        }
    }

    public record TenantListFilter(String name, String createdFrom, String createdTo,
                                   String sortField, String sortOrder) {
    }

    public record TenantView(String enterpriseId, String enterpriseName, String packageName, String provisionState,
                             String createdAt, String openedAt, String failureReason) {
    }

    public record PackageView(long id, String packageName, String packageContent) {
    }
}
