package com.iwhalecloud.byai.manager.validate.resource.annotion;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import com.iwhalecloud.byai.manager.validate.resource.rule.ResourceBizTypeValidator;
import jakarta.validation.Constraint;
import jakarta.validation.Payload;

@Documented
@Constraint(validatedBy = ResourceBizTypeValidator.class)
@Target({
    ElementType.METHOD, ElementType.FIELD, ElementType.PARAMETER
})
@Retention(RetentionPolicy.RUNTIME)
public @interface ValidResourceBizType {
    String message() default "{resourcedto.resourcebiztype}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}