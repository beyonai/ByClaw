package com.iwhalecloud.byai.manager.validate.resource.rule;


import com.iwhalecloud.byai.common.constants.resource.SystemCode;
import com.iwhalecloud.byai.manager.validate.resource.annotion.ValidSystemCode;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class SystemCodeValidator implements ConstraintValidator<ValidSystemCode, String> {

    @Override
    public void initialize(ValidSystemCode constraintAnnotation) {
        // 初始化方法
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return false; // 如果需要校验空值，请返回 false
        }
        
        for (SystemCode code : SystemCode.values()) {
            if (code.name().equalsIgnoreCase(value)) {
                return true;
            }
        }
        return false;
    }
}