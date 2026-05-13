package com.iwhalecloud.byai.common.annotation;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 聊天调用次数限制注解
 * 用于限制用户每日调用会话接口的次数
 * 
 * @author system
 * @date 2025-01-11
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface ChatCallLimit {
    
    /**
     * 限制描述
     */
    String value() default "chat.limit.description";
}
