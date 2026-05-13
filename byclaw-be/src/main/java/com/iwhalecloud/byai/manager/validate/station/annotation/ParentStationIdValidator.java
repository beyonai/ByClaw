package com.iwhalecloud.byai.manager.validate.station.annotation;

import com.iwhalecloud.byai.manager.validate.station.rule.ParentStationIdValidatorRule;
import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 注解校验父驻地标识是否存在
 */
@Target({
    ElementType.FIELD, ElementType.PARAMETER
})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Constraint(validatedBy = ParentStationIdValidatorRule.class)
public @interface ParentStationIdValidator {
    String message() default "{station.pstationid.valid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
