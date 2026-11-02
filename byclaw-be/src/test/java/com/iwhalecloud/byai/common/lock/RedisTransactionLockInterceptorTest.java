package com.iwhalecloud.byai.common.lock;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.Map;
import org.apache.ibatis.executor.Executor;
import org.apache.ibatis.mapping.*;
import org.apache.ibatis.plugin.Invocation;
import org.apache.ibatis.session.*;
import org.apache.ibatis.builder.StaticSqlSource;
import org.junit.jupiter.api.Test;

class RedisTransactionLockInterceptorTest {
    @Test void mapperContractsUseCanonicalKeysAndClearCachedReadsBeforeQuery() throws Throwable {
        var locks = mock(TransactionalRedisLockService.class);
        var interceptor = new RedisTransactionLockInterceptor(locks);
        var executor = mock(Executor.class);
        String[][] cases = {
            {"resource.DigitalEmployeePublicationMapper.lockResource", "resource:12"},
            {"resource.DigitalEmployeePublicationMapper.lock", "employee-publication:12"},
            {"resource.ResourceSyncScopeMapper.defaultEmployeesForUpdate", "user-default-employee:7:8"},
            {"groupchat.ByaiGroupChatTaskMapper.selectWithRedisLock", "group-task:9"},
            {"groupchat.ByaiGroupChatTurnMapper.lockGroup", "session:10"},
            {"session.ByaiSessionMapper.serializeById", "session:10"},
            {"datasource.DataSourceMapper.lockRow", "datasource:12"},
            {"aimodel.ByaiAimodelMapper.lockDefaultModels", "model-default"}
        };
        for (String[] entry : cases) {
            reset(locks, executor);
            var config = new Configuration();
            var statement = new MappedStatement.Builder(config, "com.iwhalecloud.byai.manager.mapper." + entry[0],
                new StaticSqlSource(config, "SELECT 1"), SqlCommandType.SELECT).build();
            Object[] arguments = {statement, Map.of("id", 12, "tenantId", 7, "userId", 8, "taskId", 9, "groupId", 10, "sessionId", 10), RowBounds.DEFAULT, null};
            interceptor.intercept(new Invocation(executor, Executor.class.getMethod("query", MappedStatement.class,
                Object.class, RowBounds.class, ResultHandler.class), arguments));
            var order = inOrder(locks, executor);
            order.verify(locks).acquire(entry[1]);
            order.verify(executor).clearLocalCache();
            order.verify(executor).query(statement, arguments[1], RowBounds.DEFAULT, null);
        }
    }
    @Test void entityWritesAndSkillGroupsUseTheSameResourceKeysInNumericOrder() throws Throwable {
        var locks = mock(TransactionalRedisLockService.class);
        var interceptor = new RedisTransactionLockInterceptor(locks);
        var executor = mock(Executor.class);
        var config = new Configuration();
        var entity = new com.iwhalecloud.byai.manager.entity.resource.SsResource();
        entity.setResourceId(12L);
        var write = new MappedStatement.Builder(config,
            "com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper.updateById",
            new StaticSqlSource(config, "UPDATE ss_resource SET resource_name = 'name' WHERE resource_id = 12"),
            SqlCommandType.UPDATE).build();
        interceptor.intercept(new Invocation(executor, Executor.class.getMethod("update", MappedStatement.class, Object.class),
            new Object[]{write, Map.of("et", entity)}));
        verify(locks).acquire("resource:12");
        reset(locks);
        var read = new MappedStatement.Builder(config,
            "com.iwhalecloud.byai.manager.mapper.resource.SkillGroupMapper.selectActiveSkillsForUpdate",
            new StaticSqlSource(config, "SELECT 1"), SqlCommandType.SELECT).build();
        interceptor.intercept(new Invocation(executor, Executor.class.getMethod("query", MappedStatement.class,
            Object.class, RowBounds.class, ResultHandler.class),
            new Object[]{read, Map.of("skillIds", java.util.List.of(12L, 2L, 12L)), RowBounds.DEFAULT, null}));
        var order = inOrder(locks);
        order.verify(locks).acquire("resource:2");
        order.verify(locks).acquire("resource:12");
        order.verifyNoMoreInteractions();
    }

}
