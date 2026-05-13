package com.iwhalecloud.byai.common.datasource.interceptor;

import java.lang.reflect.Proxy;
import java.util.Arrays;

import org.apache.commons.lang3.ClassUtils;
import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.annotation.After;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Before;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.datasource.config.CustomerContextHolder;

/**
 * User: Simon
 * Date: 14-3-21
 */
// TODO:asd
@Component
@Aspect
public class DataSourceMethodInterceptor implements Ordered {

    private Logger logger = LoggerFactory.getLogger(DataSourceMethodInterceptor.class);

    @After("execution(* com.iwhalecloud..controller.*Controller.*(..))")
    public void clean(JoinPoint joinPoint) {
        CustomerContextHolder.clearCustomerType();
    }

    @Before("execution(* com.iwhalecloud..service.*Service.*(..))||execution(* com.iwhalecloud..dao.*Mapper.*(..))")
    public void dynamicSetDataSoruce(JoinPoint joinPoint) {
        Class<?> clazz = joinPoint.getTarget().getClass();
        String className = clazz.getName();
        if (ClassUtils.isAssignable(clazz, Proxy.class)) {
            className = joinPoint.getSignature().getDeclaringTypeName();
        }
        String methodName = joinPoint.getSignature().getName();
        Object[] arguments = joinPoint.getArgs();
        // logger.info("execute {" + className + "}.{" + methodName + "}({" + Arrays.toString(arguments) + "})");
        //String path = clazz.getResource("").getPath();
//        String path =  clazz.getResource("") == null ? "" : clazz.getResource("").getPath();

        if (className.contains("BDP")) {
            CustomerContextHolder.setCustomerType(CustomerContextHolder.DATA_SOURCE_BYAI);
        }
        if (className.contains("Byai")) {
            CustomerContextHolder.setCustomerType(CustomerContextHolder.DATA_SOURCE_BYAI);
        } else if (className.contains("Phoenix")) {
            CustomerContextHolder.setCustomerType(CustomerContextHolder.DATA_SOURCE_PHOENIX);
        } else if (methodName.contains("BDP")) {
            CustomerContextHolder.setCustomerType(CustomerContextHolder.DATA_SOURCE_BYAI);
        } else if (methodName.contains("Byai")) {
            CustomerContextHolder.setCustomerType(CustomerContextHolder.DATA_SOURCE_BYAI);
        } else if (methodName.contains("Phoenix")) {
            CustomerContextHolder.setCustomerType(CustomerContextHolder.DATA_SOURCE_PHOENIX);
        } else {
            CustomerContextHolder.clearCustomerType();
        }

    }


    @Override
    public int getOrder() {
        // TODO Auto-generated method stub
        return -1;
    }
}
