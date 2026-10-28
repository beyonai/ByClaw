package com.iwhalecloud.byai.manager.domain.auth.service;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.database.ByaiDruidProperties;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.LongStream;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mybatis.spring.SqlSessionTemplate;
import org.mybatis.spring.transaction.SpringManagedTransactionFactory;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 使用实际 Mapper SQL 和 Spring 事务，验证大批次完整性及中途失败后的整体回滚。 */
class PrivilegeGrantBatchTest {
    @TempDir Path directory;
    private JdbcTemplate committed;
    private PrivilegeGrantService service;
    private PrivilegeGrantMapper mapper;
    private SequenceService sequences;
    private final AtomicLong ids = new AtomicLong();

    @BeforeEach
    void setUp() {
        var dataSource = new UnpooledDataSource("org.sqlite.JDBC",
            "jdbc:sqlite:" + directory.resolve("authorization.sqlite"), null, null);
        committed = new JdbcTemplate(dataSource);
        committed.execute("CREATE TABLE au_privilege_grant (privilege_grant_id BIGINT PRIMARY KEY, "
            + "grant_type TEXT, oper_type TEXT, grant_obj_type TEXT, grant_obj_id BIGINT, eff_date TIMESTAMP, "
            + "exp_date TIMESTAMP, status_cd TEXT, create_staff BIGINT, create_date TIMESTAMP, "
            + "update_staff BIGINT, update_date TIMESTAMP, grant_to_type TEXT, grant_to_obj_id BIGINT, "
            + "grant_to_obj_type TEXT, allow_unsubscribe TEXT)");
        committed.update("INSERT INTO au_privilege_grant(privilege_grant_id, grant_to_obj_id) VALUES (999999, 999999)");
        var configuration = new MybatisConfiguration(new Environment("test",
            new SpringManagedTransactionFactory(), dataSource));
        configuration.addMapper(PrivilegeGrantMapper.class);
        var session = new SqlSessionTemplate(new SqlSessionFactoryBuilder().build(configuration));
        mapper = spy(session.getMapper(PrivilegeGrantMapper.class));
        sequences = mock(SequenceService.class);
        when(sequences.nextValues(anyInt())).thenAnswer(call ->
            LongStream.range(0, call.getArgument(0, Integer.class)).map(ignored -> ids.incrementAndGet()).boxed().toList());
        var target = new PrivilegeGrantService();
        ReflectionTestUtils.setField(target, "privilegeGrantMapper", mapper);
        ReflectionTestUtils.setField(target, "SequenceService", sequences);
        var properties = mock(ByaiDruidProperties.class);
        when(properties.getDbType()).thenReturn("postgresql");
        ReflectionTestUtils.setField(target, "byaiDruidProperties", properties);
        var proxy = new ProxyFactory(target);
        proxy.setProxyTargetClass(true);
        proxy.addAdvice(new TransactionInterceptor(new DataSourceTransactionManager(dataSource),
            new AnnotationTransactionAttributeSource()));
        service = (PrivilegeGrantService) proxy.getProxy();
        LoginInfo login = new LoginInfo(); login.setUserId(42L);
        CurrentUserHolder.setLoginInfo(login);
    }

    @AfterEach
    void clearUser() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void insertsAll45000UserSkillPairsAndPreservesExistingData() {
        List<PrivilegeGrant> grants = grants(45000);
        service.saveBatch(grants);
        assertThat(committed.queryForObject("SELECT COUNT(*) FROM au_privilege_grant", Integer.class)).isEqualTo(45001);
        assertThat(committed.queryForObject("SELECT COUNT(DISTINCT privilege_grant_id) FROM au_privilege_grant",
            Integer.class)).isEqualTo(45001);
        assertThat(committed.queryForList("SELECT COUNT(*) FROM au_privilege_grant WHERE grant_obj_type='SKILL' "
            + "GROUP BY grant_obj_id", Integer.class)).hasSize(15).containsOnly(3000);
        assertThat(committed.queryForObject("SELECT COUNT(*) FROM au_privilege_grant WHERE create_staff=42 "
            + "AND eff_date IS NOT NULL AND create_date IS NOT NULL AND status_cd='A' AND grant_type='FORCE_USE' "
            + "AND grant_to_type='RED' AND oper_type='READ' AND grant_to_obj_type='USER' AND allow_unsubscribe='002'",
            Integer.class)).isEqualTo(45000);
        verify(mapper, times(90)).insertBatch(org.mockito.ArgumentMatchers.anyList(), org.mockito.ArgumentMatchers.eq("postgresql"));
        verify(sequences, times(90)).nextValues(500);
    }

    @Test
    void failureInSecondBatchRollsBackFirstBatchAndRetainsOldAuthorization() {
        org.mockito.Mockito.doReturn(List.of(2L)).when(sequences).nextValues(1);
        assertThatThrownBy(() -> service.saveBatch(grants(501))).isInstanceOf(RuntimeException.class);
        assertThat(committed.queryForList("SELECT grant_to_obj_id FROM au_privilege_grant", Long.class))
            .containsExactly(999999L);
        verify(mapper, times(2)).insertBatch(org.mockito.ArgumentMatchers.anyList(), org.mockito.ArgumentMatchers.eq("postgresql"));
    }

    @Test
    void shortAffectedRowCountCannotBeReportedAsSuccess() {
        org.mockito.Mockito.doReturn(0).when(mapper).insertBatch(org.mockito.ArgumentMatchers.anyList(),
            org.mockito.ArgumentMatchers.eq("postgresql"));
        assertThatThrownBy(() -> service.saveBatch(grants(2))).isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("Incomplete authorization batch");
        assertThat(committed.queryForObject("SELECT COUNT(*) FROM au_privilege_grant", Integer.class)).isEqualTo(1);
    }

    @Test
    void oracleBatchUsesOneInsertSelectStatementWithTypedNulls() {
        var configuration = new MybatisConfiguration();
        configuration.addMapper(PrivilegeGrantMapper.class);
        String sql = configuration.getMappedStatement(PrivilegeGrantMapper.class.getName() + ".insertBatch")
            .getBoundSql(java.util.Map.of("grants", grants(2), "dbType", "oracle")).getSql();
        assertThat(sql).contains("UNION ALL", "FROM dual").doesNotContain("VALUES");
    }

    private List<PrivilegeGrant> grants(int count) {
        List<PrivilegeGrant> result = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            var grant = new PrivilegeGrant();
            grant.setGrantObjId(100L + i / 3000); grant.setGrantObjType("SKILL");
            grant.setGrantToObjId(1L + i % 3000); grant.setGrantToObjType("USER");
            grant.setGrantType("FORCE_USE"); grant.setGrantToType("RED"); grant.setOperType("READ");
            grant.setStatusCd("A"); grant.setAllowUnsubscribe("002");
            result.add(grant);
        }
        return result;
    }
}
