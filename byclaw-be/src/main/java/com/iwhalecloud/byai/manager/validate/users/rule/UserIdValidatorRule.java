package com.iwhalecloud.byai.manager.validate.users.rule;

import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.manager.validate.users.annotation.UserIdValidator;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;

/**
 * @author he.duming
 * @date 2025-04-14 17:42:31
 * @description 自定义校验规则校验用户标识是否存在
 */
@Component
public class UserIdValidatorRule implements ConstraintValidator<UserIdValidator, Long> {

    @Autowired
    private UsersMapper usersMapper;

    /***
     * @param userId 用户标识
     * @param constraintValidatorContext 校验
     * @return boolean 校验结果
     */
    @Override
    public boolean isValid(Long userId, ConstraintValidatorContext constraintValidatorContext) {

        LambdaQueryWrapper<Users> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(Users::getUserId, userId);
        Long count = usersMapper.selectCount(queryWrapper);

        // 判断用户标识是否存在
        return count > 0;
    }
}