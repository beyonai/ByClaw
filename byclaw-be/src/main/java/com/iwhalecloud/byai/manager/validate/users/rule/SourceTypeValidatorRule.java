package com.iwhalecloud.byai.manager.validate.users.rule;

import com.iwhalecloud.byai.manager.validate.users.annotation.SourceTypeValidator;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import org.springframework.stereotype.Component;
import com.iwhalecloud.byai.common.constants.users.SourceType;

/**
 * @author he.duming
 * @date 2025-04-14 17:53:52
 * @description 自定义校验规则校验外系统用户类型是否存在
 */

@Component
public class SourceTypeValidatorRule implements ConstraintValidator<SourceTypeValidator, Integer> {

    /***
     * @param sourceType 来源类型:0-本系统用户；1-钉钉；2-企业微信
     * @param constraintValidatorContext 校验
     * @return boolean 校验结果
     */
    @Override
    public boolean isValid(Integer sourceType, ConstraintValidatorContext constraintValidatorContext) {
        // 校验外系统类型
        return SourceType.DING_TALK.equals(sourceType) || SourceType.WE_CHAT.equals(sourceType);
    }
}