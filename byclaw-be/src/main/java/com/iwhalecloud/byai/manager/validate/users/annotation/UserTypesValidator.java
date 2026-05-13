package com.iwhalecloud.byai.manager.validate.users.annotation;

import com.iwhalecloud.byai.manager.validate.users.rule.UserTypesValidatorRule;
import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.Target;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;

/**
 * @author zhang.zhihao 2025-11-14 9:32:00 注解校验用户角色类型是否存在
 */
@Target({
    ElementType.FIELD, ElementType.PARAMETER
})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Constraint(validatedBy = UserTypesValidatorRule.class)
public @interface UserTypesValidator {

    String message() default "";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

}
