package com.iwhalecloud.byai.common.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.cfg.CoercionAction;
import com.fasterxml.jackson.databind.cfg.CoercionInputShape;
import com.fasterxml.jackson.databind.type.LogicalType;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.fasterxml.jackson.datatype.jsr310.deser.LocalDateTimeDeserializer;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateTimeSerializer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

import java.text.SimpleDateFormat;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * Jackson JSON配置
 * 统一使用 Jackson 处理 JSON 序列化和反序列化
 * 
 * @author System
 * @since 2025-01-XX
 */
@Configuration
public class JacksonConfig {

    /**
     * 日期格式：yyyy-MM-dd HH:mm:ss
     */
    private static final String DATE_TIME_PATTERN = "yyyy-MM-dd HH:mm:ss";

    /**
     * 配置 Jackson ObjectMapper
     * 支持 @JsonSerialize 注解
     * 
     * @param builder Jackson2ObjectMapperBuilder
     * @return 配置好的 ObjectMapper
     */
    @Bean
    @Primary
    public ObjectMapper objectMapper(Jackson2ObjectMapperBuilder builder) {
        ObjectMapper objectMapper = builder.createXmlMapper(false).build();
        
        // 配置Date类型的日期格式
        objectMapper.setDateFormat(new SimpleDateFormat(DATE_TIME_PATTERN));
        
        // 配置LocalDateTime类型的日期格式
        JavaTimeModule javaTimeModule = new JavaTimeModule();
        DateTimeFormatter dateTimeFormatter = DateTimeFormatter.ofPattern(DATE_TIME_PATTERN);
        javaTimeModule.addSerializer(LocalDateTime.class, new LocalDateTimeSerializer(dateTimeFormatter));
        javaTimeModule.addDeserializer(LocalDateTime.class, new LocalDateTimeDeserializer(dateTimeFormatter));
        objectMapper.registerModule(javaTimeModule);
        
        // 禁用将日期序列化为时间戳
        objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        
        // 启用空字符串转换为空集合的兼容性（兼容 FastJson 的行为）
        objectMapper.coercionConfigFor(LogicalType.Collection)
            .setCoercion(CoercionInputShape.EmptyString, CoercionAction.AsEmpty);
        
        // 启用空字符串转换为 null 的兼容性
        objectMapper.coercionConfigDefaults()
            .setCoercion(CoercionInputShape.EmptyString, CoercionAction.AsNull);
        
        return objectMapper;
    }
}
