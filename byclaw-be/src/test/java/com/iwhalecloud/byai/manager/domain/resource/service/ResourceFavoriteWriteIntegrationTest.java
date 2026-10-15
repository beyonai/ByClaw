package com.iwhalecloud.byai.manager.domain.resource.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.request.ResourceFavoriteQo;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceFavoriteMapper;
import com.iwhalecloud.byai.manager.vo.auth.ResourceFavoriteVo;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mybatis.spring.SqlSessionFactoryBean;
import org.mybatis.spring.SqlSessionTemplate;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.integration.support.locks.DefaultLockRegistry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/** 执行生产 Mapper 的写入 SQL 和真实事务，避免 Mock 掩盖主键冲突及回滚问题。 */
class ResourceFavoriteWriteIntegrationTest {
    @TempDir Path temp;
    private JdbcTemplate jdbc;
    private TransactionTemplate transactions;
    private ResourceFavoriteMapper mapper;
    private ResourceFavoriteMapper realMapper;
    private AuthApplicationService auth;
    private ResourceFavoriteService[] nodes;

    @BeforeEach void setup() throws Exception {
        var dataSource = new DriverManagerDataSource("jdbc:sqlite:" + temp.resolve("favorites.db"));
        dataSource.setDriverClassName("org.sqlite.JDBC");
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("CREATE TABLE ss_resource(resource_id BIGINT PRIMARY KEY, resource_biz_type TEXT, owner_type TEXT, resource_status INTEGER, com_acct_id BIGINT, view_auth_controlled BOOLEAN DEFAULT FALSE, use_auth_controlled BOOLEAN DEFAULT FALSE)");
        jdbc.execute("CREATE TABLE byai_resource_favorite(com_acct_id BIGINT, user_id BIGINT, resource_id BIGINT, create_time TIMESTAMP, PRIMARY KEY(com_acct_id,user_id,resource_id))");
        jdbc.execute("CREATE TABLE byai_resource_favorite_count(com_acct_id BIGINT, resource_id BIGINT, favorite_count BIGINT NOT NULL CHECK(favorite_count>=0), PRIMARY KEY(com_acct_id,resource_id))");
        jdbc.update("INSERT INTO ss_resource(resource_id,resource_biz_type,owner_type,resource_status,com_acct_id) VALUES(33,'SKILL','enterprise',2,22)");
        jdbc.update("INSERT INTO ss_resource(resource_id,resource_biz_type,owner_type,resource_status,com_acct_id) VALUES(34,'SKILL','enterprise',2,23)");
        transactions = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        var factory = new SqlSessionFactoryBean();
        factory.setDataSource(dataSource);
        var configuration = new Configuration();
        configuration.setMapUnderscoreToCamelCase(true);
        factory.setConfiguration(configuration);
        factory.setMapperLocations(new ClassPathResource("com/iwhalecloud/byai/manager/mapper/resource/ResourceFavoriteMapper.xml"));
        realMapper = new SqlSessionTemplate(factory.getObject()).getMapper(ResourceFavoriteMapper.class);
        mapper = mock(ResourceFavoriteMapper.class, withSettings().defaultAnswer(org.mockito.AdditionalAnswers.delegatesTo(realMapper)));
        // SQLite 没有 information_schema；其余查询及写入均执行真实生产 SQL。
        doReturn(true).when(mapper).isSchemaReady();
        var config = mock(ByaiSystemConfigService.class);
        when(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")).thenReturn("commercial");
        auth = mock(AuthApplicationService.class);
        when(auth.queryCurrentUserUseBlacklistedResourceIds(any(), any())).thenReturn(Set.of());
        var registry = new DefaultLockRegistry();
        nodes = new ResourceFavoriteService[] {
            new ResourceFavoriteService(mapper, config, auth, new ResourceFavoriteLockService(registry)),
            new ResourceFavoriteService(mapper, config, auth, new ResourceFavoriteLockService(registry))
        };
    }

    @ParameterizedTest
    @ValueSource(strings = {"DIG_EMPLOYEE", "SKILL", "KG_DOC", "KG_QA", "KG_TERM", "MCP", "TOOLKIT", "AGENT"})
    void favoriteCancelAndRepeatedRequestsAreIdempotent(String type) {
        jdbc.update("UPDATE ss_resource SET resource_biz_type=? WHERE resource_id=33", type);
        assertThat(set(0, 11L, true).favoriteCount()).isEqualTo(1);
        assertThat(set(1, 11L, true).favoriteCount()).isEqualTo(1);
        assertThat(set(1, 12L, true).favoriteCount()).isEqualTo(2);
        assertThat(set(0, 11L, false).favoriteCount()).isEqualTo(1);
        assertThat(set(1, 11L, false).favoriteCount()).isEqualTo(1);
        assertThat(set(0, 12L, false).favoriteCount()).isZero();
        assertThat(set(0, 11L, true).favoriteCount()).isEqualTo(1);
        assertCounts(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"DIG_EMPLOYEE", "SKILL", "KG_DOC", "KG_QA", "KG_TERM", "MCP", "TOOLKIT", "AGENT"})
    void legacyUnscopedResourcesCanBeFavoritedWithCountsIsolatedByTenant(String type) {
        jdbc.update("UPDATE ss_resource SET resource_biz_type=?, com_acct_id=NULL, view_auth_controlled=NULL, use_auth_controlled=NULL WHERE resource_id=33", type);

        assertThat(set(0, 11L, true).favoriteCount()).isEqualTo(1);
        assertThat(set(1, 11L, true).favoriteCount()).isEqualTo(1);
        assertThat(set(1, 12L, true).favoriteCount()).isEqualTo(2);
        assertThat(set(0, 11L, 23L, true).favoriteCount()).isEqualTo(1);
        assertThat(set(0, 11L, false).favoriteCount()).isEqualTo(1);
        assertCounts(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM byai_resource_favorite WHERE com_acct_id=23 AND resource_id=33", Long.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT favorite_count FROM byai_resource_favorite_count WHERE com_acct_id=23 AND resource_id=33", Long.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT com_acct_id FROM ss_resource WHERE resource_id=33", Long.class)).isNull();
    }

    @ParameterizedTest
    @CsvSource({"true,false", "false,true", "true,true"})
    void legacyCompatibilityDoesNotExposeControlledOrOtherTenantResources(boolean viewControlled, boolean useControlled) {
        jdbc.update("UPDATE ss_resource SET com_acct_id=NULL, view_auth_controlled=?, use_auth_controlled=? WHERE resource_id=33", viewControlled, useControlled);
        assertThat(realMapper.selectResource(33L, 22L)).isNull();
        assertThat(realMapper.selectResource(34L, 22L)).isNull();
        assertThatThrownBy(() -> set(0, 11L, true))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
        verifyNoInteractions(auth);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM byai_resource_favorite", Long.class)).isZero();
    }

    @Test void legacyResourcesStillRequireShelfAvailabilityAndRespectUseBlacklists() {
        jdbc.update("UPDATE ss_resource SET com_acct_id=NULL, resource_status=3 WHERE resource_id=33");
        assertThatThrownBy(() -> set(0, 11L, true))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
        jdbc.update("UPDATE ss_resource SET resource_status=2 WHERE resource_id=33");
        when(auth.queryCurrentUserUseBlacklistedResourceIds(any(), any())).thenReturn(Set.of(33L));
        assertThatThrownBy(() -> set(0, 11L, true))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM byai_resource_favorite", Long.class)).isZero();
    }

    @Test void cancellationOfOffShelfResourceAndMissingHistoricalCounterWorks() {
        jdbc.update("UPDATE ss_resource SET resource_status=3 WHERE resource_id=33");
        jdbc.update("INSERT INTO byai_resource_favorite VALUES(22,11,33,CURRENT_TIMESTAMP)");
        assertThat(set(0, 11L, false)).isEqualTo(new ResourceFavoriteVo(false, 0));
        assertThat(set(1, 11L, false)).isEqualTo(new ResourceFavoriteVo(false, 0));
        assertCounts(0);
    }

    @ParameterizedTest
    @CsvSource({"true,false", "false,true", "true,true"})
    void controlledResourceRequiresViewPermissionButAllowsCancellationAfterRevocation(boolean viewControlled, boolean useControlled) {
        jdbc.update("UPDATE ss_resource SET view_auth_controlled=?,use_auth_controlled=? WHERE resource_id=33", viewControlled, useControlled);
        assertThatThrownBy(() -> set(0, 11L, true))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
        when(auth.hasResourceViewPermission(any())).thenReturn(true);
        assertThat(set(0, 11L, true).favoriteCount()).isEqualTo(1);
        when(auth.hasResourceViewPermission(any())).thenReturn(false);
        assertThat(set(1, 11L, false).favoriteCount()).isZero();
        assertThat(set(0, 11L, false).favoriteCount()).isZero();
        assertThatThrownBy(() -> set(1, 11L, true))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
        assertCounts(0);
    }

    @Test void failedCountUpdateRollsBackRelationAndReleasesTheLock() {
        set(0, 11L, true);
        doThrow(new IllegalStateException("simulated count failure")).when(mapper).updateCount(33L, 22L, -1);
        assertThatThrownBy(() -> set(0, 11L, false)).hasMessage("simulated count failure");
        assertCounts(1);
        doAnswer(org.mockito.AdditionalAnswers.delegatesTo(realMapper)).when(mapper).updateCount(33L, 22L, -1);
        assertThat(set(1, 11L, false).favoriteCount()).isZero();
        assertCounts(0);
    }

    @Test void twoServiceInstancesSerializeDifferentUsersAndRepeatedRequests() throws Exception {
        var added = concurrent(16, true, false);
        assertThat(added).extracting(ResourceFavoriteVo::favoriteCount)
            .containsExactlyInAnyOrderElementsOf(java.util.stream.LongStream.rangeClosed(1, 16).boxed().toList());
        assertCounts(16);
        var duplicate = concurrent(12, true, true);
        assertThat(duplicate).allSatisfy(value -> assertThat(value.favoriteCount()).isEqualTo(17));
        assertCounts(17);
        concurrent(16, false, false);
        concurrent(12, false, true);
        assertCounts(0);
    }

    @Test void cancellationCannotDeleteAnotherUsersOrTenantsFavorite() {
        set(0, 11L, true);
        assertThat(set(1, 12L, false).favoriteCount()).isEqualTo(1);
        jdbc.update("INSERT INTO byai_resource_favorite VALUES(23,11,33,CURRENT_TIMESTAMP)");
        set(0, 11L, false);
        assertCounts(0);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM byai_resource_favorite WHERE com_acct_id=23", Long.class)).isEqualTo(1);
    }

    private List<ResourceFavoriteVo> concurrent(int count, boolean target, boolean sameUser) throws Exception {
        var pool = Executors.newFixedThreadPool(6);
        var start = new CountDownLatch(1);
        try {
            List<Future<ResourceFavoriteVo>> futures = new ArrayList<>();
            for (int index = 0; index < count; index++) {
                int node = index % 2;
                long user = sameUser ? 999L : 100L + index;
                futures.add(pool.submit(() -> { start.await(); return set(node, user, target); }));
            }
            start.countDown();
            List<ResourceFavoriteVo> result = new ArrayList<>();
            for (var future : futures) result.add(future.get(10, TimeUnit.SECONDS));
            return result;
        } finally { pool.shutdownNow(); }
    }

    private ResourceFavoriteVo set(int node, Long userId, boolean target) {
        return set(node, userId, 22L, target);
    }

    private ResourceFavoriteVo set(int node, Long userId, Long tenantId, boolean target) {
        var login = new LoginInfo(); login.setUserId(userId); login.setEnterpriseId(tenantId);
        CurrentUserHolder.setLoginInfo(login);
        try {
            var input = new ResourceFavoriteQo(); input.setResourceId(33L); input.setFavorited(target);
            return transactions.execute(status -> nodes[node].setFavorite(input));
        } finally { CurrentUserHolder.setLoginInfo(null); }
    }

    private void assertCounts(long expected) {
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM byai_resource_favorite WHERE com_acct_id=22 AND resource_id=33", Long.class)).isEqualTo(expected);
        assertThat(jdbc.queryForObject("SELECT favorite_count FROM byai_resource_favorite_count WHERE com_acct_id=22 AND resource_id=33", Long.class)).isEqualTo(expected);
    }
}
