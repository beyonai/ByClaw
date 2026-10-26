package com.iwhalecloud.byai.common.lock;

import java.lang.annotation.*;

/** Mapper locking read; named parameters form a canonical business key, independent of SQL dialect. */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RedisTransactionLock {
    String value();
    String[] parameters() default {};
}
