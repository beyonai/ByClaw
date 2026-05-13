package com.iwhalecloud.byai.manager.validate.organization.rule;

import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.validate.organization.annotation.AddOrgValidator;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import org.springframework.stereotype.Component;
import org.hibernate.validator.constraintvalidation.HibernateConstraintValidatorContext;

/**
 * @author he.duming
 * @date 2025-05-08 14:10:02
 * @description 组织新增/修改校验规则
 */
@Component
public class AddOrgValidatorRule implements ConstraintValidator<AddOrgValidator, Organization> {

    /**
     * 进行新增组织的业务校验
     *
     * @param organization 组织新增
     * @param context 校验上下文
     * @return 返回校验结果
     */
    @Override
    public boolean isValid(Organization organization, ConstraintValidatorContext context) {
        // 获取当前校验的组
        HibernateConstraintValidatorContext hibernateContext = context
            .unwrap(HibernateConstraintValidatorContext.class);
        Class<?>[] groups = hibernateContext.getConstraintValidatorPayload(Class[].class);

        if (groups != null) {
            for (Class<?> group : groups) {
                if (group.equals(Add.class)) {
                    return validateAdd(organization, context);
                }
                else if (group.equals(Mod.class)) {
                    return validateMod(organization, context);
                }
            }
        }
        return true;
    }

    /**
     * 新增校验逻辑
     */
    private boolean validateAdd(Organization organization, ConstraintValidatorContext context) {
        // TODO: 实现新增校验逻辑
        return true;
    }

    /**
     * 修改校验逻辑
     */
    private boolean validateMod(Organization organization, ConstraintValidatorContext context) {
        // TODO: 实现修改校验逻辑
        return true;
    }
}
