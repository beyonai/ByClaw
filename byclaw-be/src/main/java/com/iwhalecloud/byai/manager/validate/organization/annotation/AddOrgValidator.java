package com.iwhalecloud.byai.manager.validate.organization.annotation;

import com.iwhalecloud.byai.manager.validate.organization.rule.AddOrgValidatorRule;
import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * @author he.duming
 * @date 2025-05-08 14:09:01
 * @description TODO
 */

@Target({
        ElementType.TYPE, ElementType.PARAMETER
})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Constraint(validatedBy = AddOrgValidatorRule.class)
public @interface AddOrgValidator {

    String message() default "";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
