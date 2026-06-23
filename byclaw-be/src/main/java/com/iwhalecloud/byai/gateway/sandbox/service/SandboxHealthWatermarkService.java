package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.LinkedHashMap;
import java.util.Map;

import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxHealthWatermarkModelEntity;
import org.springframework.stereotype.Service;

@Service
public class SandboxHealthWatermarkService {

    private final SandboxHealthWatermarkModelService modelService;

    public SandboxHealthWatermarkService(SandboxHealthWatermarkModelService modelService) {
        this.modelService = modelService;
    }

    public SandboxHealthLevel evaluate(SandboxHealthWatermarkModelEntity model,
                                       Double cpuRequestRatio,
                                       Double memoryLimitRatio) {
        if (model == null || cpuRequestRatio == null || memoryLimitRatio == null) {
            return SandboxHealthLevel.UNKNOWN;
        }
        if (memoryLimitRatio >= model.getCriticalMemoryLimitRatio()
            || cpuRequestRatio >= model.getCriticalCpuRequestRatio()) {
            return SandboxHealthLevel.CRITICAL;
        }
        if (memoryLimitRatio >= model.getBusyMemoryLimitRatio()
            || cpuRequestRatio >= model.getBusyCpuRequestRatio()) {
            return SandboxHealthLevel.BUSY;
        }
        if (memoryLimitRatio < model.getIdleMemoryLimitRatio()
            && cpuRequestRatio < model.getBusyCpuRequestRatio()) {
            return SandboxHealthLevel.IDLE;
        }
        return SandboxHealthLevel.NORMAL;
    }

    public Map<String, Object> preview(String serviceType, String profileKey,
                                       Double cpuRequestRatio, Double memoryLimitRatio) {
        SandboxHealthWatermarkModelEntity model = modelService.resolveModel(serviceType, profileKey);
        SandboxHealthLevel level = evaluate(model, cpuRequestRatio, memoryLimitRatio);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("healthLevel", level.name());
        result.put("model", model);
        result.put("cpuRequestRatio", cpuRequestRatio);
        result.put("memoryLimitRatio", memoryLimitRatio);
        return result;
    }
}
