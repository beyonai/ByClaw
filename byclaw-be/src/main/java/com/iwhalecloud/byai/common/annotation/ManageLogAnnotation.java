package com.iwhalecloud.byai.common.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 管理业务日志注解 可以作用在控制器或其他业务类上，用于描述当前类的功能； 也可以用于方法上，用于描述当前方法的作用；
 */
@Target({
    ElementType.METHOD, ElementType.TYPE
})
@Retention(RetentionPolicy.RUNTIME)
public @interface ManageLogAnnotation {
    /**
     * 功能名称
     * 
     * @return name
     */
    String name() default "";

    /**
     * 功能描述
     * 
     * @return description
     */
    String description() default "";
}
