package com.iwhalecloud.byai.common.web;

import com.iwhalecloud.byai.common.util.StringUtil;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.BeansException;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ApplicationContextAware;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * 这个类取得上下文相关的数据
 *
 * @author Administrator
 */
@Component
public final class ApplicationContextUtil implements ApplicationContextAware {

    /**
     * Spring应用上下文环境
     */
    private static ApplicationContext applicationContext;

    /**
     * 实现ApplicationContextAware接口的回调方法，设置上下文环境
     *
     * @param applicationContext 上下文对象
     * @throws BeansException 异常
     */
    @Override
    public void setApplicationContext(ApplicationContext applicationContext) throws BeansException {
        setApplication(applicationContext);
    }

    private static void setApplication(ApplicationContext application) {
        applicationContext = application;
    }

    /**
     * 获取类型为requiredType的对象 如果bean不能被类型转换，相应的异常将会被抛出（BeanNotOfRequiredTypeException）
     *
     * @param requiredType 返回对象类型
     * @return 返回requiredType类型对象
     * @throws BeansException
     * @author fengchao at 2015-3-30 下午2:53:49
     */
    public static <T> T getBean(Class<T> requiredType) throws BeansException {
        return applicationContext.getBean(requiredType);
    }

    /**
     * 获取类型为requiredType的对象 如果bean不能被类型转换，相应的异常将会被抛出（BeanNotOfRequiredTypeException）
     *
     * @param name bean注册名
     * @param requiredType 返回对象类型
     * @return 返回requiredType类型对象
     * @throws BeansException
     * @author fengchao at 2015-3-30 下午2:53:49
     */
    public static <T> T getBean(String name, Class<T> requiredType) throws BeansException {
        return applicationContext.getBean(name, requiredType);
    }

    /**
     * 获取环境上下文的配置文件值,如果没有值则返回null
     *
     * @param key 关键字
     * @return String
     */
    public static String getEnvProperty(String key) {
        return getEnvProperty(key, null);
    }

    /**
     * 获取环境上下文的配置文件值,如果没有值则返回默认值
     *
     * @param key 关键字
     * @param defaultValue 默认值
     * @return String
     */
    public static String getEnvProperty(String key, String defaultValue) {
        Environment env = applicationContext.getEnvironment();
        String value = env.getProperty(key);
        return StringUtil.isNotEmpty(value) ? value : defaultValue;
    }

    /**
     * 获取当前请求
     * 
     * @return HttpServletRequest
     */
    public static HttpServletRequest getRequest() {
        return ((ServletRequestAttributes) RequestContextHolder.getRequestAttributes()).getRequest();
    }

}