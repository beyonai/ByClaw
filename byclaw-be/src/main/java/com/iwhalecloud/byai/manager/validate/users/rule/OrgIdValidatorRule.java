package com.iwhalecloud.byai.manager.validate.users.rule;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.mapper.organization.OrganizationMapper;
import com.iwhalecloud.byai.manager.validate.users.annotation.OrgIdValidator;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * @author he.duming
 * @date 2025-04-13 22:43:53
 * @description 自定义校验规则校验组织是否存在
 */
public class OrgIdValidatorRule implements ConstraintValidator<OrgIdValidator, Long> {

    @Autowired
    private OrganizationMapper organizationMapper;

    @Override
    public boolean isValid(Long orgId, ConstraintValidatorContext constraintValidatorContext) {
        if (orgId == null) {
            return true;
        }

        LambdaQueryWrapper<Organization> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(Organization::getOrgId, orgId);
        Long count = organizationMapper.selectCount(queryWrapper);
        // 判断组织信息是否存在
        return count > 0;
    }
}
