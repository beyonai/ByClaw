package com.iwhalecloud.byai.manager.validate.resource.annotion;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import com.iwhalecloud.byai.manager.validate.resource.rule.SystemCodeValidator;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

@Documented
@Constraint(validatedBy = SystemCodeValidator.class)
@Target({
    ElementType.METHOD, ElementType.FIELD, ElementType.PARAMETER
})
@Retention(RetentionPolicy.RUNTIME)
public @interface ValidSystemCode {
    String message() default "{resourcedto.systemcode}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}