package com.iwhalecloud.byai.manager.validate.users.rule;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import com.iwhalecloud.byai.manager.mapper.staticdata.ByaiSystemConfigListMapper;
import com.iwhalecloud.byai.manager.validate.users.annotation.UserTypesValidator;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * @author zhang.zhihao 2025-04-13 23:32:26 自定义校验规则校验用户角色是否存在
 */
@Component
public class UserTypesValidatorRule implements ConstraintValidator<UserTypesValidator, List<String>> {

    private static final String PARAM_TYPE_USER_TYPE = "USER_TYPE";

    @Autowired
    private ByaiSystemConfigListMapper byaiSystemConfigListMapper;

    /**
     * 校验用户角色类型是否均为系统配置的合法类型（参考系统配置 USER_TYPE 枚举）
     * 合法角色类型：ORG_MAN(组织管理)、BUSINESS_MAN(业务管理)、PLAT_MAN(平台管理)、ORD_USER(普通用户)、PLAT_DEVOPS(平台运维)、DEV_USER(技术开发)
     *
     * @param userTypes 待校验的用户角色类型列表（可为空，空列表直接返回合法）
     * @param constraintValidatorContext 校验上下文（用于自定义错误信息，当前未使用）
     * @return true - 所有角色类型均合法；false - 存在非法角色类型
     */
    @Override
    public boolean isValid(List<String> userTypes, ConstraintValidatorContext constraintValidatorContext) {
        if (CollectionUtils.isEmpty(userTypes)) {
            return true;
        }

        LambdaQueryWrapper<ByaiSystemConfigList> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiSystemConfigList::getParamGroupCode, PARAM_TYPE_USER_TYPE);
        List<ByaiSystemConfigList> byaiSystemConfigLists = byaiSystemConfigListMapper.selectList(queryWrapper);
        Set<String> userTypeSet = byaiSystemConfigLists.stream().map(ByaiSystemConfigList::getParamValue)
            .collect(Collectors.toSet());

        // 判断userTypes是否包含在userTypeList中
        return userTypeSet.containsAll(userTypes);
    }
}
