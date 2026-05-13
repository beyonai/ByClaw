package com.iwhalecloud.byai.manager.validate.resource.rule;

import com.iwhalecloud.byai.common.constants.resource.ResourceHostType;
import org.apache.commons.lang3.StringUtils;

import com.iwhalecloud.byai.manager.validate.resource.annotion.ValidResourceHostType;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class ResourceHostTypeValidator implements ConstraintValidator<ValidResourceHostType, String> {

    @Override
    public void initialize(ValidResourceHostType constraintAnnotation) {
        // 初始化方法
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (StringUtils.isBlank(value)) {
            return false;
        }

        for (ResourceHostType code : ResourceHostType.values()) {
            if (code.getCode().equals(value)) {
                return true;
            }
        }
        return false;
    }
}