package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxHealthWatermarkModelMapper;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxHealthWatermarkModelEntity;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SandboxHealthWatermarkModelService {

    private static final String MODEL_KEY_PREFIX = "byclaw:sandbox:health:model:";

    private final SandboxHealthWatermarkModelMapper mapper;
    private final SandboxProperties properties;

    public SandboxHealthWatermarkModelService(SandboxHealthWatermarkModelMapper mapper, SandboxProperties properties) {
        this.mapper = mapper;
        this.properties = properties;
    }

    public List<SandboxHealthWatermarkModelEntity> list(String serviceType, String profileKey, Integer enabled) {
        return mapper.selectModels(normalizeServiceType(serviceType, false), normalizeProfileKey(profileKey), enabled);
    }

    @Transactional
    public SandboxHealthWatermarkModelEntity save(SandboxHealthWatermarkModelEntity entity) {
        normalize(entity);
        validate(entity);
        if (Integer.valueOf(1).equals(entity.getEnabled())) {
            SandboxHealthWatermarkModelEntity peer =
                mapper.selectEnabledPeer(entity.getServiceType(), entity.getProfileKey(), entity.getId());
            if (peer != null) {
                throw new BdpRuntimeException("同一服务类型和规格只能启用一个水位模型");
            }
        }
        if (entity.getId() == null) {
            mapper.insertModel(entity);
        }
        else {
            mapper.updateModel(entity);
        }
        refreshCache(entity.getServiceType(), entity.getProfileKey());
        return entity;
    }

    @Transactional
    public void delete(Long id) {
        SandboxHealthWatermarkModelEntity entity = mapper.selectById(id);
        if (entity == null) {
            return;
        }
        mapper.deleteById(id);
        refreshCache(entity.getServiceType(), entity.getProfileKey());
    }

    @Transactional
    public void enable(Long id, boolean enabled) {
        SandboxHealthWatermarkModelEntity entity = mapper.selectById(id);
        if (entity == null) {
            throw new BdpRuntimeException("水位模型不存在");
        }
        if (enabled) {
            SandboxHealthWatermarkModelEntity peer =
                mapper.selectEnabledPeer(entity.getServiceType(), entity.getProfileKey(), id);
            if (peer != null) {
                throw new BdpRuntimeException("同一服务类型和规格只能启用一个水位模型");
            }
        }
        mapper.updateEnabled(id, enabled ? 1 : 0);
        refreshCache(entity.getServiceType(), entity.getProfileKey());
    }

    public SandboxHealthWatermarkModelEntity resolveModel(String serviceType, String profileKey) {
        String normalizedServiceType = normalizeServiceType(serviceType, true);
        String normalizedProfileKey = normalizeProfileKey(profileKey);
        String cacheKey = modelKey(normalizedServiceType, normalizedProfileKey);
        String cached = RedisUtil.getString(cacheKey);
        if (StringUtils.isNotBlank(cached)) {
            return JSON.parseObject(cached, SandboxHealthWatermarkModelEntity.class);
        }
        SandboxHealthWatermarkModelEntity model = mapper.selectEnabledExact(normalizedServiceType, normalizedProfileKey);
        if (model == null && StringUtils.isNotBlank(normalizedProfileKey)) {
            model = mapper.selectEnabledServiceDefault(normalizedServiceType);
        }
        if (model == null) {
            model = mapper.selectEnabledDefault();
        }
        if (model == null) {
            model = defaultModel(normalizedServiceType, normalizedProfileKey);
        }
        RedisUtil.setString(cacheKey, JSON.toJSONString(model),
            properties.getHealth().getModelCacheTtlSeconds(), TimeUnit.SECONDS);
        return model;
    }

    public void refreshCache(String serviceType, String profileKey) {
        RedisUtil.removeKey(modelKey(normalizeServiceType(serviceType, true), normalizeProfileKey(profileKey)));
        RedisUtil.delByPrefix(MODEL_KEY_PREFIX);
    }

    public SandboxHealthWatermarkModelEntity fromParams(Map<String, Object> params) {
        SandboxHealthWatermarkModelEntity entity = new SandboxHealthWatermarkModelEntity();
        entity.setId(longValue(params.get("id")));
        entity.setModelName(stringValue(params.get("modelName")));
        entity.setServiceType(stringValue(params.get("serviceType")));
        entity.setProfileKey(stringValue(params.get("profileKey")));
        entity.setEnabled(intValue(params.get("enabled"), 1));
        entity.setPriority(intValue(params.get("priority"), 0));
        entity.setIdleMemoryLimitRatio(doubleValue(params.get("idleMemoryLimitRatio"), null));
        entity.setBusyMemoryLimitRatio(doubleValue(params.get("busyMemoryLimitRatio"), null));
        entity.setCriticalMemoryLimitRatio(doubleValue(params.get("criticalMemoryLimitRatio"), null));
        entity.setBusyCpuRequestRatio(doubleValue(params.get("busyCpuRequestRatio"), null));
        entity.setCriticalCpuRequestRatio(doubleValue(params.get("criticalCpuRequestRatio"), null));
        entity.setConsecutiveBusySamples(intValue(params.get("consecutiveBusySamples"), 2));
        entity.setRecoverSamples(intValue(params.get("recoverSamples"), 2));
        entity.setSampleIntervalSeconds(intValue(params.get("sampleIntervalSeconds"), 30));
        entity.setSnapshotTtlSeconds(intValue(params.get("snapshotTtlSeconds"), 120));
        entity.setWatchTtlSeconds(intValue(params.get("watchTtlSeconds"), 90));
        entity.setRemark(stringValue(params.get("remark")));
        return entity;
    }

    private void normalize(SandboxHealthWatermarkModelEntity entity) {
        entity.setServiceType(normalizeServiceType(entity.getServiceType(), true));
        entity.setProfileKey(normalizeProfileKey(entity.getProfileKey()));
        if (StringUtils.isBlank(entity.getModelName())) {
            entity.setModelName(entity.getServiceType()
                + (StringUtils.isBlank(entity.getProfileKey()) ? "" : "-" + entity.getProfileKey()));
        }
        if (entity.getEnabled() == null) {
            entity.setEnabled(1);
        }
        if (entity.getPriority() == null) {
            entity.setPriority(0);
        }
    }

    private void validate(SandboxHealthWatermarkModelEntity entity) {
        if (StringUtils.isBlank(entity.getServiceType())) {
            throw new BdpRuntimeException("serviceType is required");
        }
        requireRatio(entity.getIdleMemoryLimitRatio(), "idleMemoryLimitRatio");
        requireRatio(entity.getBusyMemoryLimitRatio(), "busyMemoryLimitRatio");
        requireRatio(entity.getCriticalMemoryLimitRatio(), "criticalMemoryLimitRatio");
        requireRatio(entity.getBusyCpuRequestRatio(), "busyCpuRequestRatio");
        requireRatio(entity.getCriticalCpuRequestRatio(), "criticalCpuRequestRatio");
        if (!(entity.getIdleMemoryLimitRatio() < entity.getBusyMemoryLimitRatio()
            && entity.getBusyMemoryLimitRatio() < entity.getCriticalMemoryLimitRatio())) {
            throw new BdpRuntimeException("内存阈值必须满足 idle < busy < critical");
        }
        if (!(entity.getBusyCpuRequestRatio() < entity.getCriticalCpuRequestRatio())) {
            throw new BdpRuntimeException("CPU 阈值必须满足 busy < critical");
        }
        requirePositive(entity.getConsecutiveBusySamples(), "consecutiveBusySamples");
        requirePositive(entity.getRecoverSamples(), "recoverSamples");
        requirePositive(entity.getSampleIntervalSeconds(), "sampleIntervalSeconds");
        requirePositive(entity.getSnapshotTtlSeconds(), "snapshotTtlSeconds");
        requirePositive(entity.getWatchTtlSeconds(), "watchTtlSeconds");
    }

    private void requireRatio(Double value, String fieldName) {
        if (value == null || value < 0D || value > 3D) {
            throw new BdpRuntimeException(fieldName + " must be between 0 and 3");
        }
    }

    private void requirePositive(Integer value, String fieldName) {
        if (value == null || value < 1) {
            throw new BdpRuntimeException(fieldName + " must be greater than 0");
        }
    }

    private SandboxHealthWatermarkModelEntity defaultModel(String serviceType, String profileKey) {
        SandboxProperties.HealthConfig config = properties.getHealth();
        SandboxHealthWatermarkModelEntity model = new SandboxHealthWatermarkModelEntity();
        model.setModelName("built-in-default");
        model.setServiceType(serviceType);
        model.setProfileKey(profileKey);
        model.setEnabled(1);
        model.setPriority(0);
        model.setIdleMemoryLimitRatio(config.getIdleMemoryLimitRatio());
        model.setBusyMemoryLimitRatio(config.getBusyMemoryLimitRatio());
        model.setCriticalMemoryLimitRatio(config.getCriticalMemoryLimitRatio());
        model.setBusyCpuRequestRatio(config.getBusyCpuRequestRatio());
        model.setCriticalCpuRequestRatio(config.getCriticalCpuRequestRatio());
        model.setConsecutiveBusySamples(config.getConsecutiveBusySamples());
        model.setRecoverSamples(config.getRecoverSamples());
        model.setSampleIntervalSeconds(config.getSampleIntervalSeconds());
        model.setSnapshotTtlSeconds(config.getSnapshotTtlSeconds());
        model.setWatchTtlSeconds(config.getWatchTtlSeconds());
        return model;
    }

    private static String modelKey(String serviceType, String profileKey) {
        return MODEL_KEY_PREFIX + serviceType + ":" + StringUtils.defaultIfBlank(profileKey, "_");
    }

    private static String normalizeServiceType(String value, boolean defaultWhenBlank) {
        if (StringUtils.isBlank(value)) {
            return defaultWhenBlank ? "default" : null;
        }
        return value.trim().toLowerCase(Locale.ROOT);
    }

    private static String normalizeProfileKey(String value) {
        return StringUtils.isBlank(value) ? null : value.trim().toLowerCase(Locale.ROOT);
    }

    private static String stringValue(Object value) {
        return value == null ? null : String.valueOf(value).trim();
    }

    private static Long longValue(Object value) {
        if (value == null || StringUtils.isBlank(String.valueOf(value))) {
            return null;
        }
        return Long.parseLong(String.valueOf(value));
    }

    private static Integer intValue(Object value, Integer defaultValue) {
        if (value == null || StringUtils.isBlank(String.valueOf(value))) {
            return defaultValue;
        }
        if (value instanceof Boolean b) {
            return b ? 1 : 0;
        }
        return Integer.parseInt(String.valueOf(value));
    }

    private static Double doubleValue(Object value, Double defaultValue) {
        if (value == null || StringUtils.isBlank(String.valueOf(value))) {
            return defaultValue;
        }
        return Double.parseDouble(String.valueOf(value));
    }
}
