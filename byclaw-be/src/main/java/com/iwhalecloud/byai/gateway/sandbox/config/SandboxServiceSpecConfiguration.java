package com.iwhalecloud.byai.gateway.sandbox.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.spec.MybatisSandboxServiceSpecRepository;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;

/**
 * 沙箱 service spec 与主应用 ORM 统一，直接读取表 {@code sandbox_service_spec}。
 */
@Configuration
public class SandboxServiceSpecConfiguration {

    @Bean
    public SandboxServiceSpecRepository sandboxServiceSpecRepository(SandboxServiceSpecEntityMapper mapper) {
        return new MybatisSandboxServiceSpecRepository(mapper);
    }
}
