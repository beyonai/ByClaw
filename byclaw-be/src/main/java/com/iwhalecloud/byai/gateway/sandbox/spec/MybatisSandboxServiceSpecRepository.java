package com.iwhalecloud.byai.gateway.sandbox.spec;

import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity;

/**
 * 通过主应用 ORM 访问表 {@code sandbox_service_spec} 直读 spec；无进程内缓存。
 */
public class MybatisSandboxServiceSpecRepository implements SandboxServiceSpecRepository {

    private static final Logger log = LoggerFactory.getLogger(MybatisSandboxServiceSpecRepository.class);

    private final SandboxServiceSpecEntityMapper specEntityMapper;
    private final ObjectMapper objectMapper;

    public MybatisSandboxServiceSpecRepository(SandboxServiceSpecEntityMapper specEntityMapper) {
        this.specEntityMapper = specEntityMapper;
        this.objectMapper = new ObjectMapper();
    }

    @Override
    public Optional<SandboxServiceSpec> findByServiceKey(String serviceKey) {
        if (serviceKey == null || serviceKey.isBlank()) {
            return Optional.empty();
        }

        return Optional.ofNullable(queryOne(serviceKey));
    }

    private SandboxServiceSpec queryOne(String serviceKey) {
        try {
            SandboxServiceSpecEntity entity = specEntityMapper.selectOne(
                    new LambdaQueryWrapper<SandboxServiceSpecEntity>()
                            .eq(SandboxServiceSpecEntity::getServiceKey, serviceKey));
            if (entity == null) {
                return null;
            }
            String specJson = entity.getSpecJson();
            if (specJson == null || specJson.isBlank()) {
                return null;
            }
            SandboxServiceSpec sandboxServiceSpec = objectMapper.readValue(specJson, SandboxServiceSpec.class);
            sandboxServiceSpec.setTemplateJson(entity.getTemplateJson());
            return sandboxServiceSpec;
        } catch (DataAccessException e) {
            log.warn("Failed to query sandbox_service_spec for serviceKey={}: {}", serviceKey, e.getMessage());
            return null;
        } catch (Exception e) {
            log.warn("Failed to parse sandbox service spec json: {}", e.getMessage());
            return null;
        }
    }
}
