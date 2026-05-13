package com.iwhalecloud.byai.manager.validate.users.annotation;

import com.iwhalecloud.byai.manager.validate.users.rule.UserTypeValidatorRule;
import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * @author he.duming
 * @date 2025-04-13 23:30:55
 * @description 注解校验用户角色类型是否存在
 */

@Target({
    ElementType.FIELD, ElementType.PARAMETER
})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Constraint(validatedBy = UserTypeValidatorRule.class)
public @interface UserTypeValidator {

    String message() default "";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

}
