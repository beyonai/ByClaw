package com.iwhalecloud.byai.manager.validate.users.rule;

import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.mapper.position.PositionMapper;
import com.iwhalecloud.byai.manager.validate.users.annotation.PositionIdValidator;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;

/**
 * @author he.duming
 * @date 2025-04-13 22:43:53
 * @description 自定义校验规则校验岗位标识是否存在
 */
@Component
public class PositionIdValidatorRule implements ConstraintValidator<PositionIdValidator, Long> {

    @Autowired
    private PositionMapper positionMapper;

    /***
     * @param positionId 职位标识
     * @param constraintValidatorContext 校验
     * @return boolean 校验结果
     */
    @Override
    public boolean isValid(Long positionId, ConstraintValidatorContext constraintValidatorContext) {

        // 岗位非必填，如果填了，校验准确性
        if (positionId == null) {
            return true;
        }

        LambdaQueryWrapper<Position> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(Position::getPositionId, positionId);
        Long count = positionMapper.selectCount(queryWrapper);

        // 判断岗位信息是否存在
        return count > 0;
    }
}
