package com.iwhalecloud.byai.manager.application.service.auth;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.common.constants.auth.GrantType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.auth.AuthDTO;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.qo.auth.AuthDetailQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceMemberSettingQo;
import java.nio.file.Path;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.context.MessageSource;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 用真实 SQL 和事务验证合并抽屉的查询范围、保留、撤销及回滚，不连接业务环境。 */
class ResourceUseAuthorizationDrawerTest {

    @TempDir
    Path directory;

    private AuthApplicationService service;
    private PrivilegeGrantService grants;
    private AuthRedisSyncService cache;
    private SetOperations<String, String> redisSets;
    private UnpooledDataSource dataSource;
    private JdbcTemplate jdbc;
    private Object originalRedis;
    private Object originalMessageSource;
    private final AtomicLong ids = new AtomicLong();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        if (TableInfoHelper.getTableInfo(PrivilegeGrant.class) == null) {
            TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""),
                PrivilegeGrant.class);
        }
        dataSource = new UnpooledDataSource("org.sqlite.JDBC",
            "jdbc:sqlite:" + directory.resolve("drawer.sqlite"), null, null);
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("CREATE TABLE au_privilege_grant (privilege_grant_id BIGINT PRIMARY KEY, grant_type TEXT, "
            + "grant_obj_type TEXT, grant_obj_id BIGINT, grant_to_obj_type TEXT, grant_to_obj_id BIGINT, "
            + "grant_to_type TEXT, oper_type TEXT, status_cd TEXT, allow_unsubscribe TEXT, "
            + "eff_date BIGINT, exp_date BIGINT)");
        service = spy(new AuthApplicationService());
        grants = mock(PrivilegeGrantService.class);
        cache = mock(AuthRedisSyncService.class);
        var mapper = mock(PrivilegeGrantMapper.class);
        var resources = mock(SsResourceMapper.class);
        var resourceService = mock(SsResourceService.class);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", mapper);
        ReflectionTestUtils.setField(service, "privilegeGrantService", grants);
        ReflectionTestUtils.setField(service, "ssResourceMapper", resources);
        ReflectionTestUtils.setField(service, "ssResourceService", resourceService);
        ReflectionTestUtils.setField(service, "authRedisSyncService", cache);
        ReflectionTestUtils.setField(service, "employeeGroupAuthorizationService",
            mock(DigitalEmployeeGroupAuthorizationService.class));
        SsResource skill = new SsResource();
        skill.setResourceId(13L);
        skill.setResourceBizType("SKILL");
        skill.setOwnerType("enterprise");
        skill.setCreateBy(1L);
        when(resources.selectById(13L)).thenReturn(skill);
        when(resourceService.findById(13L)).thenReturn(skill);
        doAnswer(call -> "对象" + call.getArgument(1)).when(service).getName(anyString(), any());
        LoginInfo login = new LoginInfo();
        login.setUserId(1L);
        login.setUserCode("adminvip");
        CurrentUserHolder.setLoginInfo(login);

        when(mapper.selectList(any())).thenAnswer(call -> {
            SqlParameters sql = renderQuery(call.getArgument(0));
            return jdbc.query("SELECT * FROM au_privilege_grant WHERE " + sql.sql(),
                this::readGrant, sql.parameters());
        });
        when(mapper.selectCount(any())).thenAnswer(call -> {
            SqlParameters sql = renderQuery(call.getArgument(0));
            return jdbc.queryForObject("SELECT COUNT(*) FROM au_privilege_grant WHERE " + sql.sql(),
                Long.class, sql.parameters());
        });
        when(grants.findPrivilegeGrant(anyString(), anyString(), any(), anyString())).thenAnswer(call ->
            jdbc.query("SELECT * FROM au_privilege_grant WHERE status_cd='A' AND grant_type=? "
                + "AND grant_obj_type=? AND grant_obj_id=? AND grant_to_type=?", this::readGrant,
                call.getArgument(0), call.getArgument(1), call.getArgument(2), call.getArgument(3)));
        doAnswer(call -> {
            PrivilegeGrant grant = call.getArgument(0);
            grant.setStatusCd("X");
            jdbc.update("UPDATE au_privilege_grant SET status_cd='X' WHERE privilege_grant_id=?",
                grant.getPrivilegeGrantId());
            return null;
        }).when(grants).remove(any());
        doAnswer(call -> {
            insert(call.getArgument(0));
            return null;
        }).when(grants).save(any());
        doAnswer(call -> {
            PrivilegeGrant grant = call.getArgument(0);
            jdbc.update("UPDATE au_privilege_grant SET allow_unsubscribe=? WHERE privilege_grant_id=?",
                grant.getAllowUnsubscribe(), grant.getPrivilegeGrantId());
            return null;
        }).when(grants).update(any());

        originalRedis = ReflectionTestUtils.getField(RedisUtil.class, "instance");
        originalMessageSource = ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        var redis = new RedisUtil();
        var template = mock(StringRedisTemplate.class);
        redisSets = mock(SetOperations.class);
        when(template.opsForSet()).thenReturn(redisSets);
        ReflectionTestUtils.setField(redis, "stringRedisTemplate", template);
        ReflectionTestUtils.setField(RedisUtil.class, "instance", redis);
        var messages = mock(MessageSource.class);
        when(messages.getMessage(anyString(), any(Object[].class), any(Locale.class)))
            .thenAnswer(call -> call.getArgument(0));
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
        ReflectionTestUtils.setField(RedisUtil.class, "instance", originalRedis);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
    }

    @Test
    void mergedDetailIncludesBothFormalTypesAndKeepsTargetDimensionsAndColorsSeparate() {
        insert(grant(GrantType.AVAILABLE_USE, "USER", 10000118L, "RED", "A"));
        insert(grant(GrantType.FORCE_USE, "USER", 10000118L, "RED", "A"));
        insert(grant(GrantType.FORCE_USE, "USER", 20L, "RED", "A"));
        insert(grant(GrantType.AVAILABLE_USE, "ORG", 10000118L, "RED", "A"));
        insert(grant(GrantType.AVAILABLE_USE, "USER", 10000118L, "BLACK", "A"));
        insert(grant(GrantType.FORCE_USE, "USER", 10000118L, "BLACK", "A"));
        insert(grant(GrantType.AVAILABLE_USE, "USER", 30L, "RED", "P"));
        insert(grant(GrantType.AVAILABLE_USE, "USER", 40L, "RED", "X"));
        insert(grant(GrantType.ALLOW_MANAGE, "USER", 50L, "RED", "A"));
        var otherId = grant(GrantType.AVAILABLE_USE, "USER", 60L, "RED", "A");
        otherId.setGrantObjId(14L);
        insert(otherId);
        var otherType = grant(GrantType.AVAILABLE_USE, "USER", 70L, "RED", "A");
        otherType.setGrantObjType("MCP");
        insert(otherType);

        Map<String, Object> result = detail(GrantType.FORCE_USE, "SKILL", true);
        assertThat(targets(result, "redList")).containsExactlyInAnyOrder(
            "USER:10000118", "USER:20", "ORG:10000118", "USER:1");
        assertThat(targets(result, "blackList")).containsExactly("USER:10000118");
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void managementAndEmployeeDetailsRemainSingleTypeEvenWhenMergeIsRequested(boolean includeFamily) {
        insert(grant(GrantType.AVAILABLE_USE, "USER", 2L, "RED", "A"));
        insert(grant(GrantType.FORCE_USE, "USER", 3L, "RED", "A"));
        insert(grant(GrantType.ALLOW_MANAGE, "USER", 4L, "RED", "A"));
        assertThat(targets(detail(GrantType.ALLOW_MANAGE, "SKILL", includeFamily), "redList"))
            .containsExactlyInAnyOrder("USER:4", "USER:1");
        for (String type : List.of(GrantType.AVAILABLE_USE, GrantType.FORCE_USE)) {
            var employeeGrant = grant(type, "USER", type.equals(GrantType.FORCE_USE) ? 6L : 5L, "RED", "A");
            employeeGrant.setGrantObjType("DIG_EMPLOYEE");
            insert(employeeGrant);
        }
        assertThat(targets(detail(GrantType.FORCE_USE, "DIG_EMPLOYEE", includeFamily), "redList"))
            .containsExactlyInAnyOrder("USER:6", "USER:1");
    }

    @Test
    void legacyDetailStillQueriesOnlyRequestedType() {
        insert(grant(GrantType.AVAILABLE_USE, "USER", 2L, "RED", "A"));
        insert(grant(GrantType.FORCE_USE, "USER", 3L, "RED", "A"));
        assertThat(targets(detail(GrantType.FORCE_USE, "SKILL", null), "redList"))
            .containsExactlyInAnyOrder("USER:3", "USER:1");
    }

    @Test
    void keepingAvailableTargetsPreservesDatesAndDoesNotCreateDuplicateForceGrants() {
        var existing = grant(GrantType.AVAILABLE_USE, "USER", 2L, "RED", "A");
        existing.setEffDate(new Date(1000L));
        existing.setExpDate(new Date(2000L));
        existing.setAllowUnsubscribe("001");
        insert(existing);
        insert(grant(GrantType.AVAILABLE_USE, "ORG", 3L, "BLACK", "A"));
        insert(grant(GrantType.AVAILABLE_USE, "USER", 4L, "RED", "A"));
        insert(grant(GrantType.FORCE_USE, "USER", 4L, "RED", "A"));
        ResourceMemberSettingQo request = request(true);
        request.setRedList(List.of(target("USER", 2L), target("USER", 4L), target("USER", 5L)));
        request.setBlackList(List.of(target("ORG", 3L)));

        service.setResourceUsers(request);

        assertThat(jdbc.queryForMap("SELECT status_cd, allow_unsubscribe "
            + "FROM au_privilege_grant WHERE privilege_grant_id=?", existing.getPrivilegeGrantId()))
            .containsEntry("status_cd", "A").containsEntry("allow_unsubscribe", "001");
        assertThat(jdbc.queryForObject("SELECT eff_date FROM au_privilege_grant WHERE privilege_grant_id=?",
            Long.class, existing.getPrivilegeGrantId())).isEqualTo(1000L);
        assertThat(jdbc.queryForObject("SELECT exp_date FROM au_privilege_grant WHERE privilege_grant_id=?",
            Long.class, existing.getPrivilegeGrantId())).isEqualTo(2000L);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM au_privilege_grant WHERE status_cd='A' "
            + "AND grant_type='FORCE_USE' AND grant_to_obj_id IN (2,3)", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM au_privilege_grant WHERE status_cd='A' "
            + "AND grant_type='FORCE_USE' AND grant_to_obj_id IN (4,5)", Integer.class)).isEqualTo(2);
        verify(grants, never()).update(argThat(row -> GrantType.AVAILABLE_USE.equals(row.getGrantType())));
        verify(grants, never()).remove(any());
    }

    @Test
    void removingMergedTargetsRevokesBothTypesAndHistoricalDuplicatesWithoutTouchingOtherScopes() {
        insert(grant(GrantType.AVAILABLE_USE, "USER", 2L, "RED", "A"));
        insert(grant(GrantType.AVAILABLE_USE, "USER", 2L, "RED", "A"));
        insert(grant(GrantType.FORCE_USE, "USER", 2L, "RED", "A"));
        insert(grant(GrantType.FORCE_USE, "USER", 2L, "RED", "A"));
        insert(grant(GrantType.AVAILABLE_USE, "USER", 3L, "BLACK", "A"));
        insert(grant(GrantType.FORCE_USE, "USER", 3L, "BLACK", "A"));
        insert(grant(GrantType.AVAILABLE_USE, "ORG", 2L, "RED", "A"));
        insert(grant(GrantType.AVAILABLE_USE, "USER", 2L, "RED", "P"));
        var other = grant(GrantType.AVAILABLE_USE, "USER", 2L, "RED", "A");
        other.setGrantObjId(14L);
        insert(other);
        var otherType = grant(GrantType.AVAILABLE_USE, "USER", 2L, "RED", "A");
        otherType.setGrantObjType("MCP");
        insert(otherType);
        ResourceMemberSettingQo request = request(true);
        request.setRedList(List.of(target("ORG", 2L)));

        service.setResourceUsers(request);

        assertThat(jdbc.queryForList("SELECT status_cd FROM au_privilege_grant WHERE grant_obj_type='SKILL' "
            + "AND grant_obj_id=13 AND grant_to_obj_type='USER' AND status_cd!='P'", String.class))
            .containsOnly("X").hasSize(6);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM au_privilege_grant WHERE status_cd='A'", Integer.class))
            .isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM au_privilege_grant WHERE status_cd='P'", Integer.class))
            .isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"RED", "BLACK"})
    void movingTargetBetweenColorsReplacesBothOldTypesWithTheNewColor(String previousColor) {
        insert(grant(GrantType.AVAILABLE_USE, "USER", 2L, previousColor, "A"));
        insert(grant(GrantType.FORCE_USE, "USER", 2L, previousColor, "A"));
        ResourceMemberSettingQo request = request(true);
        String newColor = "RED".equals(previousColor) ? "BLACK" : "RED";
        if ("RED".equals(newColor)) {
            request.setRedList(List.of(target("USER", 2L)));
        } else {
            request.setBlackList(List.of(target("USER", 2L)));
        }

        service.setResourceUsers(request);

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM au_privilege_grant WHERE status_cd='X'", Integer.class))
            .isEqualTo(2);
        assertThat(jdbc.queryForMap("SELECT grant_type, grant_to_type FROM au_privilege_grant WHERE status_cd='A'"))
            .containsEntry("grant_type", GrantType.FORCE_USE).containsEntry("grant_to_type", newColor);
    }

    @Test
    void availableRedGrantDoesNotPreventAddingTheSameTargetToTheBlackList() {
        insert(grant(GrantType.AVAILABLE_USE, "USER", 2L, "RED", "A"));
        ResourceMemberSettingQo request = request(true);
        request.setRedList(List.of(target("USER", 2L)));
        request.setBlackList(List.of(target("USER", 2L)));

        service.setResourceUsers(request);

        assertThat(jdbc.queryForList("SELECT grant_to_type FROM au_privilege_grant WHERE status_cd='A'", String.class))
            .containsExactlyInAnyOrder("RED", "BLACK");
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void legacySaveDoesNotRevokeAvailableRecords(boolean explicitFalse) {
        insert(grant(GrantType.AVAILABLE_USE, "USER", 2L, "RED", "A"));
        insert(grant(GrantType.AVAILABLE_USE, "USER", 3L, "BLACK", "A"));
        insert(grant(GrantType.FORCE_USE, "USER", 4L, "RED", "A"));
        ResourceMemberSettingQo request = request(explicitFalse ? false : null);

        service.setResourceUsers(request);

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM au_privilege_grant WHERE status_cd='A'", Integer.class))
            .isEqualTo(2);
        verify(grants, never()).remove(argThat(row -> GrantType.AVAILABLE_USE.equals(row.getGrantType())));
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void mergedRemovalAndForceWriteCommitTogetherAndPublishCachesOnlyAfterCommit(boolean fail) {
        insert(grant(GrantType.AVAILABLE_USE, "USER", 2L, "RED", "A"));
        if (fail) {
            doThrow(new BaseException("force write failed")).when(service).handleAuth(any());
        } else {
            doAnswer(call -> {
                // AVAILABLE_USE 已在事务中撤销，FORCE_USE 写入前两类缓存仍不能发布变化。
                verifyNoInteractions(cache, redisSets);
                insert(call.getArgument(0));
                return null;
            }).when(grants).save(any());
        }
        var factory = new ProxyFactory(service);
        factory.setProxyTargetClass(true);
        factory.addAdvice(new TransactionInterceptor(new DataSourceTransactionManager(dataSource),
            new AnnotationTransactionAttributeSource()));
        AuthApplicationService transactional = (AuthApplicationService) factory.getProxy();
        ResourceMemberSettingQo request = request(true);
        request.setRedList(List.of(target("USER", 5L)));

        if (fail) {
            assertThatThrownBy(() -> transactional.setResourceUsers(request)).hasMessage("force write failed");
            assertThat(jdbc.queryForList("SELECT status_cd FROM au_privilege_grant", String.class)).containsExactly("A");
            verifyNoInteractions(cache, redisSets);
        } else {
            transactional.setResourceUsers(request);
            assertThat(jdbc.queryForObject("SELECT status_cd FROM au_privilege_grant WHERE grant_to_obj_id=2",
                String.class)).isEqualTo("X");
            assertThat(jdbc.queryForObject("SELECT status_cd FROM au_privilege_grant WHERE grant_to_obj_id=5",
                String.class)).isEqualTo("A");
            verify(cache).asyncSyncAuthChangedUsers(java.util.Set.of(2L), GrantType.AVAILABLE_USE);
            verify(cache).asyncSyncAuthChangedUsers(java.util.Set.of(5L), GrantType.FORCE_USE);
            verify(redisSets).remove("DATASET:AUTHORITY:1_RED_READ_PERSON_2", "SKILL_13");
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> detail(String type, String resourceType, Boolean includeFamily) {
        AuthDetailQo request = new AuthDetailQo();
        request.setGrantType(type);
        request.setGrantObjType(resourceType);
        request.setGrantObjId(13L);
        request.setIncludeUseGrantFamily(includeFamily);
        return (Map<String, Object>) service.listAuthDetail(request).getData();
    }

    @SuppressWarnings("unchecked")
    private List<String> targets(Map<String, Object> result, String list) {
        return ((List<AuthDTO>) result.get(list)).stream()
            .map(target -> target.getGrantToObjType() + ":" + target.getGrantToObjId()).toList();
    }

    private ResourceMemberSettingQo request(Boolean includeFamily) {
        ResourceMemberSettingQo request = new ResourceMemberSettingQo();
        request.setResourceId(13L);
        request.setIncludeUseGrantFamily(includeFamily);
        return request;
    }

    private AuthDTO target(String targetType, Long targetId) {
        AuthDTO target = new AuthDTO();
        target.setGrantToObjType(targetType);
        target.setGrantToObjId(targetId);
        return target;
    }

    private PrivilegeGrant grant(String type, String targetType, Long targetId, String color, String status) {
        PrivilegeGrant grant = new PrivilegeGrant();
        grant.setGrantType(type);
        grant.setGrantObjType("SKILL");
        grant.setGrantObjId(13L);
        grant.setGrantToObjType(targetType);
        grant.setGrantToObjId(targetId);
        grant.setGrantToType(color);
        grant.setOperType("READ");
        grant.setStatusCd(status);
        grant.setAllowUnsubscribe("002");
        return grant;
    }

    private void insert(PrivilegeGrant grant) {
        grant.setPrivilegeGrantId(ids.incrementAndGet());
        jdbc.update("INSERT INTO au_privilege_grant VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            grant.getPrivilegeGrantId(), grant.getGrantType(), grant.getGrantObjType(), grant.getGrantObjId(),
            grant.getGrantToObjType(), grant.getGrantToObjId(), grant.getGrantToType(), grant.getOperType(),
            grant.getStatusCd(), grant.getAllowUnsubscribe(),
            grant.getEffDate() == null ? null : grant.getEffDate().getTime(),
            grant.getExpDate() == null ? null : grant.getExpDate().getTime());
    }

    private PrivilegeGrant readGrant(ResultSet row, int rowNumber) throws SQLException {
        PrivilegeGrant grant = grant(row.getString("grant_type"), row.getString("grant_to_obj_type"),
            row.getLong("grant_to_obj_id"), row.getString("grant_to_type"), row.getString("status_cd"));
        grant.setPrivilegeGrantId(row.getLong("privilege_grant_id"));
        grant.setGrantObjType(row.getString("grant_obj_type"));
        grant.setGrantObjId(row.getLong("grant_obj_id"));
        grant.setAllowUnsubscribe(row.getString("allow_unsubscribe"));
        long effective = row.getLong("eff_date");
        grant.setEffDate(row.wasNull() ? null : new Date(effective));
        long expiry = row.getLong("exp_date");
        grant.setExpDate(row.wasNull() ? null : new Date(expiry));
        return grant;
    }

    /** 执行服务层真实生成的 WHERE 条件，验证类型、资源、状态过滤而非在 mock 中复制过滤逻辑。 */
    private SqlParameters renderQuery(LambdaQueryWrapper<PrivilegeGrant> query) {
        var matcher = Pattern.compile("#\\{ew\\.paramNameValuePairs\\.([^}]+)}").matcher(query.getSqlSegment());
        List<Object> parameters = new ArrayList<>();
        while (matcher.find()) {
            parameters.add(query.getParamNameValuePairs().get(matcher.group(1)));
        }
        return new SqlParameters(matcher.replaceAll("?"), parameters.toArray());
    }

    private record SqlParameters(String sql, Object[] parameters) {}
}
