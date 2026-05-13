package com.iwhalecloud.byai.manager.validate.users.annotation;

import com.iwhalecloud.byai.manager.validate.users.rule.PositionIdValidatorRule;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

/**
 * @author he.duming
 * @date 2025-04-13 22:42:10
 * @description 注解校验岗位标识是否存在
 */
@Target({
    ElementType.FIELD, ElementType.PARAMETER
})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Constraint(validatedBy = PositionIdValidatorRule.class)
public @interface PositionIdValidator {

    String message() default "";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
