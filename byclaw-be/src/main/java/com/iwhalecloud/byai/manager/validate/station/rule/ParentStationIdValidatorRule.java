package com.iwhalecloud.byai.manager.validate.station.rule;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.station.Station;
import com.iwhalecloud.byai.manager.mapper.station.StationMapper;
import com.iwhalecloud.byai.manager.validate.station.annotation.ParentStationIdValidator;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 自定义校验规则校验父驻地是否存在
 */
@Component
public class ParentStationIdValidatorRule implements ConstraintValidator<ParentStationIdValidator, Long> {

    @Autowired
    private StationMapper stationMapper;

    /**
     * @param pStationId 父驻地ID
     * @param context 校验上下文
     * @return boolean 校验结果
     */
    @Override
    public boolean isValid(Long pStationId, ConstraintValidatorContext context) {
        // -1为根节点，允许
        if (pStationId == null || pStationId == -1) {
            return true;
        }
        LambdaQueryWrapper<Station> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(Station::getStationId, pStationId);
        Long count = stationMapper.selectCount(queryWrapper);
        // 判断父驻地是否存在
        return count > 0;
    }
}
