package com.iwhalecloud.byai.manager.validate.organization.annotation;

/**
 * @author he.duming
 * @date 2025-04-14 01:29:51
 * @description TODO
 */

import com.iwhalecloud.byai.manager.validate.organization.rule.ParentOrgIdValidatorRule;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * @author he.duming
 * @date 2025-04-13 22:43:53
 * @description 注解校验父组织标识是否存在
 */

@Target({
    ElementType.FIELD, ElementType.PARAMETER
})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Constraint(validatedBy = ParentOrgIdValidatorRule.class)
public @interface ParentOrgIdValidator {

    String message() default "";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
