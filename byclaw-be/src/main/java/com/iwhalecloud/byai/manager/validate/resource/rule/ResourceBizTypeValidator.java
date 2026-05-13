package com.iwhalecloud.byai.manager.validate.resource.rule;

import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.manager.validate.resource.annotion.ValidResourceBizType;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class ResourceBizTypeValidator implements ConstraintValidator<ValidResourceBizType, String> {

    @Override
    public void initialize(ValidResourceBizType constraintAnnotation) {
        // 初始化方法
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return false; // 如果需要校验空值，请返回 false
        }

        for (ResourceBizType code : ResourceBizType.values()) {
            if (code.name().equals(value)) {
                return true;
            }
        }
        return false;
    }
}