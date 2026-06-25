package com.iwhalecloud.byai.gateway.sandbox.spec;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceProfileEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceProfileEntity;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity;

/**
 * 通过主应用 ORM 访问表 {@code sandbox_service_spec} 直读 spec；无进程内缓存。
 */
public class MybatisSandboxServiceSpecRepository implements SandboxServiceSpecRepository {

    private static final Logger log = LoggerFactory.getLogger(MybatisSandboxServiceSpecRepository.class);

    private final SandboxServiceSpecEntityMapper specEntityMapper;
    private final SandboxServiceProfileEntityMapper profileEntityMapper;
    private final SandboxProperties properties;
    private final ObjectMapper objectMapper;

    public MybatisSandboxServiceSpecRepository(SandboxServiceSpecEntityMapper specEntityMapper,
                                               SandboxServiceProfileEntityMapper profileEntityMapper,
                                               SandboxProperties properties) {
        this.specEntityMapper = specEntityMapper;
        this.profileEntityMapper = profileEntityMapper;
        this.properties = properties;
        this.objectMapper = new ObjectMapper();
    }

    @Override
    public Optional<SandboxServiceSpec> findByServiceKey(String serviceKey) {
        if (serviceKey == null || serviceKey.isBlank()) {
            return Optional.empty();
        }

        return findByServiceKeyAndProfile(serviceKey, null);
    }

    @Override
    public Optional<SandboxServiceSpec> findByServiceKeyAndProfile(String serviceKey, String profileKey) {
        if (serviceKey == null || serviceKey.isBlank()) {
            return Optional.empty();
        }

        return Optional.ofNullable(queryOne(serviceKey, profileKey));
    }

    private SandboxServiceSpec queryOne(String serviceKey, String requestedProfileKey) {
        try {
            SandboxServiceSpecEntity entity = querySpecEntity(serviceKey);
            if (entity == null) {
                return null;
            }
            String specJson = entity.getSpecJson();
            if (specJson == null || specJson.isBlank()) {
                return null;
            }
            String serviceType = resolveServiceType(entity, serviceKey);
            SandboxServiceProfileEntity profile = resolveProfile(entity, serviceType, requestedProfileKey);
            if (profile != null && profile.getTemplatePatchJson() != null && !profile.getTemplatePatchJson().isBlank()) {
                specJson = mergeJson(specJson, profile.getTemplatePatchJson());
            }
            SandboxServiceSpec sandboxServiceSpec = objectMapper.readValue(specJson, SandboxServiceSpec.class);
            sandboxServiceSpec.setTemplateJson(entity.getTemplateJson());
            sandboxServiceSpec.setServiceType(serviceType);
            if (profile != null) {
                sandboxServiceSpec.setProfileKey(profile.getProfileKey());
                sandboxServiceSpec.setResourceRequests(parseStringMap(profile.getResourceRequests()));
                Map<String, String> profileLimits = parseStringMap(profile.getResourceLimits());
                if (profileLimits != null && !profileLimits.isEmpty()) {
                    sandboxServiceSpec.setResourceLimits(profileLimits);
                }
            }
            return sandboxServiceSpec;
        } catch (DataAccessException e) {
            log.warn("Failed to query sandbox_service_spec for serviceKey={}: {}", serviceKey, e.getMessage());
            return null;
        } catch (Exception e) {
            log.warn("Failed to parse sandbox service spec json: {}", e.getMessage());
            return null;
        }
    }

    private SandboxServiceSpecEntity querySpecEntity(String serviceKey) {
        SandboxServiceSpecEntity byKey = isProfileEnabled()
            ? specEntityMapper.selectProfileAwareByServiceKey(serviceKey)
            : specEntityMapper.selectLegacyByServiceKey(serviceKey);
        if (byKey != null) {
            return byKey;
        }
        if (!isProfileEnabled()) {
            return null;
        }
        String serviceType = parseServiceType(serviceKey);
        if (serviceType == null || serviceType.equals(serviceKey)) {
            return null;
        }
        return specEntityMapper.selectProfileAwareByServiceType(serviceType);
    }

    private SandboxServiceProfileEntity resolveProfile(SandboxServiceSpecEntity entity,
                                                       String serviceType,
                                                       String requestedProfileKey) {
        if (!isProfileEnabled() || profileEntityMapper == null || serviceType == null || serviceType.isBlank()) {
            return null;
        }
        String profileKey = requestedProfileKey;
        if (profileKey == null || profileKey.isBlank()) {
            profileKey = parseProfileKey(entity.getServiceKey(), serviceType);
        }
        if (profileKey == null || profileKey.isBlank()) {
            profileKey = entity.getDefaultProfileKey();
        }
        if (profileKey == null || profileKey.isBlank()) {
            return null;
        }
        return profileEntityMapper.selectEnabledProfile(serviceType, profileKey.trim());
    }

    private boolean isProfileEnabled() {
        return properties != null && properties.getProfile() != null && properties.getProfile().isEnabled();
    }

    private String resolveServiceType(SandboxServiceSpecEntity entity, String serviceKey) {
        if (entity != null && entity.getServiceType() != null && !entity.getServiceType().isBlank()) {
            return entity.getServiceType();
        }
        return parseServiceType(serviceKey);
    }

    private String parseServiceType(String serviceKey) {
        if (serviceKey == null) {
            return null;
        }
        String value = serviceKey.trim();
        int dash = value.lastIndexOf('-');
        return dash > 0 ? value.substring(0, dash) : value;
    }

    private String parseProfileKey(String serviceKey, String serviceType) {
        if (serviceKey == null || serviceType == null) {
            return null;
        }
        String prefix = serviceType + "-";
        String value = serviceKey.trim();
        if (value.startsWith(prefix) && value.length() > prefix.length()) {
            return value.substring(prefix.length());
        }
        return null;
    }

    private Map<String, String> parseStringMap(String json) throws Exception {
        if (json == null || json.isBlank()) {
            return null;
        }
        return objectMapper.readValue(json, new TypeReference<LinkedHashMap<String, String>>() {});
    }

    private String mergeJson(String baseJson, String patchJson) throws Exception {
        JsonNode base = objectMapper.readTree(baseJson);
        JsonNode patch = objectMapper.readTree(patchJson);
        if (base instanceof ObjectNode baseObject && patch instanceof ObjectNode patchObject) {
            deepMerge(baseObject, patchObject);
            return objectMapper.writeValueAsString(baseObject);
        }
        return baseJson;
    }

    private void deepMerge(ObjectNode target, ObjectNode patch) {
        patch.fields().forEachRemaining(entry -> {
            JsonNode current = target.get(entry.getKey());
            JsonNode value = entry.getValue();
            if (current instanceof ObjectNode currentObject && value instanceof ObjectNode valueObject) {
                deepMerge(currentObject, valueObject);
            }
            else {
                target.set(entry.getKey(), value);
            }
        });
    }
}
