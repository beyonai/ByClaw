package com.iwhalecloud.byai.manager.domain.resource.validator.impl;

import com.iwhalecloud.byai.manager.dto.resource.ResourceDto;
import com.iwhalecloud.byai.manager.domain.resource.validator.AbstractResourceValidator;
import org.springframework.stereotype.Component;

/**
 * 文档库资源校验器
 */
@Component
public class DocResourceValidator extends AbstractResourceValidator {
    
    @Override
    protected void doValidate(ResourceDto resource) {
        // 文档库无特殊校验
        return;
    }
    

}