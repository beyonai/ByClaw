package com.iwhalecloud.byai.manager.validate.users.rule;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import com.iwhalecloud.byai.manager.mapper.staticdata.ByaiSystemConfigListMapper;
import com.iwhalecloud.byai.manager.validate.users.annotation.UserTypeValidator;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * @author he.duming
 * @date 2025-04-13 23:32:26
 * @description 自定义校验规则校验用户角色是否存在
 */
@Component
public class UserTypeValidatorRule implements ConstraintValidator<UserTypeValidator, String> {

    @Autowired
    private ByaiSystemConfigListMapper byaiSystemConfigListMapper;

    /**
     * 校验用户角色类型：ORG_MAN:组织管理,BUSINESS_MAN:业务管理,PLAT_MAN:平台管理,ORD_USER:普通用户,PLAT_DEVOPS:平台运维
     *
     * @param userType 用户角色类型
     * @param constraintValidatorContext 约束
     * @return boolean
     */
    @Override
    public boolean isValid(String userType, ConstraintValidatorContext constraintValidatorContext) {

        if (userType == null || userType.isEmpty()) {
            return true;
        }

        LambdaQueryWrapper<ByaiSystemConfigList> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiSystemConfigList::getParamGroupCode, "USER_TYPE");
        queryWrapper.eq(ByaiSystemConfigList::getParamValue, userType);
        long count = byaiSystemConfigListMapper.selectCount(queryWrapper);
        return count > 0;
    }
}
