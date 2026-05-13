package com.iwhalecloud.byai.manager.validate.resource.annotion;

import com.iwhalecloud.byai.manager.validate.resource.rule.ResourceSampleValidator;
import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target({ ElementType.FIELD, ElementType.PARAMETER })
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = ResourceSampleValidator.class)
@Documented
public @interface ValidResourceSample {
    String message() default "{resourcedto.resourcesample.validate}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}