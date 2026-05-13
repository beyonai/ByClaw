package com.iwhalecloud.byai.manager.validate.organization.rule;

import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.mapper.organization.OrganizationMapper;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import com.iwhalecloud.byai.manager.validate.organization.annotation.ParentOrgIdValidator;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;

/**
 * @author he.duming
 * @date 2025-04-13 22:43:53
 * @description 自定义校验规则校验组织是否存在
 */
@Component
public class ParentOrgIdValidatorRule implements ConstraintValidator<ParentOrgIdValidator, Long> {

    @Autowired
    private OrganizationMapper organizationMapper;

    /***
     * @param parentOrgId 上级组织
     * @param constraintValidatorContext 校验
     * @return boolean 校验结果
     */
    @Override
    public boolean isValid(Long parentOrgId, ConstraintValidatorContext constraintValidatorContext) {

        // 挂载根组织-1
        if (parentOrgId == null || parentOrgId == -1) {
            return true;
        }

        LambdaQueryWrapper<Organization> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(Organization::getOrgId, parentOrgId);
        Long count = organizationMapper.selectCount(queryWrapper);

        // 判断组织是否存在
        return count > 0;
    }
}
