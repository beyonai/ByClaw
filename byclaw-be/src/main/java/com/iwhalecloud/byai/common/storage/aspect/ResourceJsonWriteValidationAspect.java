package com.iwhalecloud.byai.common.storage.aspect;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.storage.validation.ResourceJsonValidationService;

/**
 * 在资源文件写入开放目录前校验标准资源 JSON 文件。
 */
@Aspect
@Component
public class ResourceJsonWriteValidationAspect {

    private final ResourceJsonValidationService resourceJsonValidationService;

    public ResourceJsonWriteValidationAspect(ResourceJsonValidationService resourceJsonValidationService) {
        this.resourceJsonValidationService = resourceJsonValidationService;
    }

    @Around("target(com.iwhalecloud.byai.common.storage.ResourceFS)"
        + " && execution(* write(org.springframework.web.multipart.MultipartFile, java.lang.String))"
        + " && args(multipartFile,filePath)")
    public Object validateResourceJsonBeforeWrite(ProceedingJoinPoint joinPoint, MultipartFile multipartFile,
        String filePath) throws Throwable {

        resourceJsonValidationService.validateIfResourceJson(multipartFile, filePath);
        return joinPoint.proceed();
    }
}
