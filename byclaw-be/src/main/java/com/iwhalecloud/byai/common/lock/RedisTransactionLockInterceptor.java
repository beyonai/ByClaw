package com.iwhalecloud.byai.common.lock;

import java.lang.reflect.Method;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.apache.ibatis.executor.Executor;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.plugin.*;
import org.apache.ibatis.session.ResultHandler;
import org.apache.ibatis.session.RowBounds;
import org.springframework.stereotype.Component;

/** Enforces mapper lock contracts before reading, including calls through MyBatis default methods. */
@Component
@Intercepts({
    @Signature(type = Executor.class, method = "query", args = {MappedStatement.class, Object.class, RowBounds.class, ResultHandler.class}),
    @Signature(type = Executor.class, method = "query", args = {MappedStatement.class, Object.class, RowBounds.class, ResultHandler.class, org.apache.ibatis.cache.CacheKey.class, org.apache.ibatis.mapping.BoundSql.class}),
    @Signature(type = Executor.class, method = "update", args = {MappedStatement.class, Object.class})
})
public class RedisTransactionLockInterceptor implements Interceptor {
    private final TransactionalRedisLockService locks;
    private final Map<String, Optional<RedisTransactionLock>> contracts = new ConcurrentHashMap<>();

    public RedisTransactionLockInterceptor(TransactionalRedisLockService locks) { this.locks = locks; }

    @Override public Object intercept(Invocation invocation) throws Throwable {
        MappedStatement statement = (MappedStatement) invocation.getArgs()[0];
        var contract = contracts.computeIfAbsent(statement.getId(), this::contract);
        if (contract.isPresent()) {
            var annotation = contract.get();
            Object input = invocation.getArgs()[1];
            java.util.List<String> keys = new java.util.ArrayList<>();
            keys.add(annotation.value());
            for (String parameter : annotation.parameters()) {
                Object value = input instanceof Map<?, ?> ? org.apache.ibatis.reflection.SystemMetaObject.forObject(input).getValue(parameter) : input;
                if (value == null) throw new IllegalArgumentException("Missing lock parameter: " + parameter);
                if (value instanceof java.util.Collection<?> values) {
                    var expanded = new java.util.ArrayList<String>();
                    for (String prefix : keys) for (Object element : values) expanded.add(prefix + ':' + element);
                    keys = expanded;
                } else {
                    for (int index = 0; index < keys.size(); index++) keys.set(index, keys.get(index) + ':' + value);
                }
            }
            keys.stream().distinct().sorted(this::compareKeys).forEach(locks::acquire);
            // A transaction may have read before waiting; never reuse that stale local snapshot.
            ((Executor) invocation.getTarget()).clearLocalCache();
        }
        return invocation.proceed();
    }

    private int compareKeys(String left, String right) {
        // Resource batches use the same numeric ID order as lifecycle/reconciliation services.
        try {
            return Long.compare(Long.parseLong(left.substring(left.lastIndexOf(':') + 1)),
                Long.parseLong(right.substring(right.lastIndexOf(':') + 1)));
        } catch (NumberFormatException ignored) {
            return left.compareTo(right);
        }
    }

    private Optional<RedisTransactionLock> contract(String statementId) {
        int split = statementId.lastIndexOf('.');
        try {
            Class<?> mapper = Class.forName(statementId.substring(0, split));
            for (Method method : mapper.getMethods()) {
                if (method.getName().equals(statementId.substring(split + 1))) {
                    var annotation = method.getAnnotation(RedisTransactionLock.class);
                    if (annotation != null) return Optional.of(annotation);
                }
            }
            return Optional.empty();
        } catch (ClassNotFoundException ignored) {
            return Optional.empty();
        }
    }
}
