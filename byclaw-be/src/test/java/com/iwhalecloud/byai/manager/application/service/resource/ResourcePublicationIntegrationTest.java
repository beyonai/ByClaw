package com.iwhalecloud.byai.manager.application.service.resource;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGovernanceService;
import com.iwhalecloud.byai.manager.application.service.organization.OrganizationAdminService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.dto.resource.ResourcePublishScope;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.*;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import org.apache.ibatis.mapping.Environment;
import org.junit.jupiter.api.*;
import org.mybatis.spring.SqlSessionTemplate;
import org.mybatis.spring.transaction.SpringManagedTransactionFactory;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Real SQL and Spring transactions; H2 does not validate PostgreSQL's partial active-request index. */
class ResourcePublicationIntegrationTest {
    ResourcePublicationService service;
    ResourcePublicationAccess access;
    JdbcTemplate jdbc;
    SsResourceMapper resources;
    AuthApplicationService auth;
    OrganizationAdminService admins;
    OrganizationService organizations;
    DigitalEmployeeGovernanceService governance;
    @BeforeEach void setup() throws Exception {
        login("adminvip", 10L, 1L);
        var ds = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;INIT=CREATE SCHEMA IF NOT EXISTS byai\\;SET SCHEMA byai");
        jdbc = new JdbcTemplate(ds);
        var config = new MybatisConfiguration();
        config.setEnvironment(new Environment("publication", new SpringManagedTransactionFactory(), ds));
        config.addMapper(SsResourceMapper.class); config.addMapper(ResourcePublicationMapper.class);
        config.addMapper(ResourcePublicationTargetMapper.class); config.addMapper(ResourcePublishScopeMapper.class);
        var pages = new com.github.pagehelper.PageInterceptor();
        Properties props = new Properties(); props.setProperty("helperDialect", "h2"); pages.setProperties(props); config.addInterceptor(pages);
        var session = new SqlSessionTemplate(new MybatisSqlSessionFactoryBuilder().build(config));
        var info = TableInfoHelper.getTableInfo(SsResource.class);
        StringBuilder columns = new StringBuilder("resource_id BIGINT PRIMARY KEY");
        for (var field : info.getFieldList()) {
            if (field.getColumn().startsWith("publish_scope_")) continue;
            Class<?> type = field.getPropertyType();
            String sqlType = type == Long.class || type == Integer.class ? "BIGINT" : type == Boolean.class ? "BOOLEAN" : java.util.Date.class.isAssignableFrom(type) ? "TIMESTAMP" : "VARCHAR(10000)";
            columns.append(",").append(field.getColumn()).append(" ").append(sqlType);
        }
        jdbc.execute("CREATE TABLE ss_resource(" + columns + ")");
        // An existing row must retain LEGACY and no new grants after the migration.
        jdbc.update("INSERT INTO ss_resource(resource_id,resource_name) VALUES(99,'legacy')");
        Path root = Path.of("").toAbsolutePath(); while (!Files.isDirectory(root.resolve("deploy/migrations"))) root = root.getParent();
        String ddl = Files.readString(root.resolve("deploy/migrations/versions/V0.6.0/V0.6.0__ddl.sql"))
            .split("-- RESOURCE_ORGANIZATION_PUBLICATION")[1]
            .split("-- END RESOURCE_ORGANIZATION_PUBLICATION")[0]
            .replaceFirst("(?s)CREATE UNIQUE INDEX uq_resource_publication_active\\b.*?;", "");
        try (var connection = ds.getConnection()) { ScriptUtils.executeSqlScript(connection, new ByteArrayResource(ddl.getBytes(java.nio.charset.StandardCharsets.UTF_8))); }
        assertThat(jdbc.queryForObject("SELECT publish_scope_mode FROM ss_resource WHERE resource_id=99", String.class)).isEqualTo("LEGACY");
        resources = session.getMapper(SsResourceMapper.class);
        var scopes = session.getMapper(ResourcePublishScopeMapper.class);
        admins = mock(OrganizationAdminService.class); organizations = mock(OrganizationService.class);
        when(admins.allowedOrgIds()).thenReturn(Set.of(100L, 101L, 200L));
        when(admins.userOrgIds(anyLong())).thenReturn(Set.of(101L));
        List<Organization> orgs = new ArrayList<>();
        for (long id : new long[]{100, 101, 200}) { var org = new Organization(); org.setOrgId(id); org.setParentOrgId(id == 101 ? 100L : -1L); org.setOrgName("Org " + id); orgs.add(org); }
        when(organizations.selectList(isNull(), any())).thenReturn(orgs);
        access = new ResourcePublicationAccess(admins, organizations, scopes);
        auth = mock(AuthApplicationService.class); when(auth.isCurrentUserGlobalResourceManager()).thenReturn(true);
        var sequence = mock(SequenceService.class); var ids = new AtomicLong(1000); when(sequence.nextVal()).thenAnswer(i -> ids.incrementAndGet());
        governance = mock(DigitalEmployeeGovernanceService.class);
        var target = new ResourcePublicationService(session.getMapper(ResourcePublicationMapper.class), session.getMapper(ResourcePublicationTargetMapper.class), scopes, resources, access, auth,
            governance, mock(SsResExtSkillService.class), sequence);
        ProxyFactory proxy = new ProxyFactory(target);
        proxy.addAdvice(new TransactionInterceptor(new DataSourceTransactionManager(ds), new AnnotationTransactionAttributeSource()));
        service = (ResourcePublicationService) proxy.getProxy();
        var resource = new SsResource(); resource.setResourceId(1L); resource.setComAcctId(1L); resource.setCreateBy(10L);
        resource.setResourceBizType("KG_DOC"); resource.setOwnerType("enterprise"); resource.setResourceName("Scoped knowledge");
        resource.setResourceStatus(2); resource.setPublishScopeMode("NONE"); resource.setPublishScopeRevision(0L); resource.setPublishScopeController("BYAI"); resources.insert(resource);
    }
    static void login(String code, long user, long tenant) { var login = new LoginInfo(); login.setUserCode(code); login.setUserId(user); login.setEnterpriseId(tenant); CurrentUserHolder.setLoginInfo(login); }
    @AfterEach void cleanup() { CurrentUserHolder.setLoginInfo(null); }
    ResourcePublicationService.Command command(ResourcePublicationService.Detail d, List<Long> orgs, Boolean decision) {
        return new ResourcePublicationService.Command(1L, d.publication().getRequestId(), d.publication().getRevision(), d.scopeRevision(), null, null, null, orgs, decision, null);
    }
    ResourcePublicationService.Detail prepare(String op, ResourcePublishScope scope, String key) {
        return service.prepare(new ResourcePublicationService.Command(1L, null, null, null, op, scope, key, null, null, null));
    }
    ResourcePublicationService.Detail submit(String op, ResourcePublishScope scope) { var d = prepare(op, scope, UUID.randomUUID().toString()); return service.submit(command(d, null, null)); }
    ResourcePublishScope orgs(Long... ids) { return new ResourcePublishScope("ORGS", List.of(ids)); }
    @Test void sourceReviewProtectionSurvivesCopyEditsAndSourceDeletion() {
        var source = new SsResource(); source.setResourceId(2L); source.setCreateBy(77L); resources.insert(source);
        when(governance.isAdminVipCreator(77L)).thenReturn(true);
        jdbc.update("UPDATE ss_resource SET resource_biz_type='SKILL',publication_source_id=2 WHERE resource_id=1");
        var submitted = submit("PUBLISH", orgs(100L));
        assertThat(submitted.publication().getSourceResourceId()).isEqualTo(2L);
        jdbc.update("UPDATE ss_resource SET publication_source_id=NULL WHERE resource_id=1");
        resources.deleteById(2L);
        login("org-reviewer", 20, 1); when(admins.managedOrgIds()).thenReturn(Set.of(100L));
        assertThatThrownBy(() -> service.review(command(submitted, List.of(100L), true))).hasMessageContaining("审核");
        login("adminvip", 10, 1);
        service.withdraw(command(submitted, null, null));
        var resubmitted = submit("PUBLISH", orgs(100L));
        assertThat(resubmitted.publication().getSourceResourceId()).isEqualTo(2L);
        login("org-reviewer", 20, 1);
        assertThatThrownBy(() -> service.review(command(resubmitted, List.of(100L), true))).hasMessageContaining("审核");
        login("adminvip", 10, 1);
        assertThat(service.review(command(resubmitted, List.of(100L), true)).scopeMode()).isEqualTo("ORGS");
    }
    @Test void normalizationRejectsForeignOrganizationsAndCollapsesDescendants() {
        assertThat(access.normalize(orgs(101L, 100L, 200L, 100L))).containsExactly(100L, 200L);
        assertThatThrownBy(() -> access.normalize(orgs(999L))).hasMessageContaining("不属于当前企业");
        assertThatThrownBy(() -> access.normalize(orgs())).hasMessageContaining("组织");
        login("adminvip", 10, 2); assertThatThrownBy(() -> service.current(1L)).hasMessageContaining("不属于当前企业");
    }
    @Test void partialApprovalWithdrawalAndRetractionNeverGrantUsePermissions() {
        var submitted = submit("PUBLISH", orgs(100L, 200L));
        assertThat(access.liveIds(1L)).isEmpty();
        assertThat(submitted.publication().getRequestedScopeJson()).isEqualTo("[\"100\",\"200\"]");
        var partial = service.review(command(submitted, List.of(100L), true));
        assertThat(partial.scopeMode()).isEqualTo("ORGS"); assertThat(access.liveIds(1L)).containsExactly(100L);
        var withdrawn = service.withdraw(command(partial, null, null));
        assertThat(access.liveIds(1L)).containsExactly(100L);
        assertThat(withdrawn.targets()).extracting(t -> t.target().getStatus()).containsExactly("APPROVED", "CANCELLED");
        var retract = new ResourcePublicationService.Command(1L, null, null, withdrawn.scopeRevision(), null, null, "remove-1", List.of(100L), null, null);
        var removed = service.retract(retract); assertThat(removed.scopeMode()).isEqualTo("NONE");
        assertThat(service.retract(retract).publication().getRequestId()).isEqualTo(removed.publication().getRequestId());
        assertThat(access.liveIds(1L)).isEmpty();
        verify(auth, never()).ensureCreatorDefaultPrivileges(any());
    }
    @Test void replacementOnlyBecomesEffectiveAfterEveryApprovalAndStaleWriterRollsBack() {
        var company = submit("PUBLISH", ResourcePublishScope.company()); service.review(command(company, List.of(-1L), true));
        var replace = submit("REPLACE_SCOPE", orgs(100L, 200L));
        var partial = service.review(command(replace, List.of(100L), true));
        assertThat(access.liveIds(1L)).containsExactly(-1L);
        assertThat(partial.targets().get(0).target().getAppliedAt()).isNull();
        assertThatThrownBy(() -> service.review(command(replace, List.of(200L), true))).hasMessageContaining("已更新");
        var complete = service.review(command(partial, List.of(200L), true));
        assertThat(complete.publication().getStatus()).isEqualTo("CLOSED");
        assertThat(access.liveIds(1L)).containsExactly(100L, 200L);
        assertThat(complete.targets()).allMatch(t -> t.target().getAppliedAt() != null);
    }
    @Test void rejectionAndChangedSnapshotDoNotAlterExistingScope() {
        var company = submit("PUBLISH", ResourcePublishScope.company()); service.review(command(company, List.of(-1L), true));
        var replace = submit("REPLACE_SCOPE", orgs(100L, 200L));
        var partial = service.review(command(replace, List.of(100L), true));
        service.review(command(partial, List.of(200L), false)); assertThat(access.liveIds(1L)).containsExactly(-1L);
        var next = submit("REPLACE_SCOPE", orgs(100L)); long revision = next.scopeRevision();
        jdbc.update("UPDATE ss_resource SET resource_name='changed' WHERE resource_id=1");
        assertThatThrownBy(() -> service.review(command(next, List.of(100L), true))).hasMessageContaining("内容已变更");
        assertThat(resources.selectById(1L).getPublishScopeRevision()).isEqualTo(revision);
        assertThat(access.liveIds(1L)).containsExactly(-1L);
    }
    @Test void syncDefaultsRequiresReviewAndOmissionOrLocalOwnershipPreservesScopes() {
        assertThat(service.synchronize(1L, null, true)).containsEntry("reason", "SUBMITTED");
        assertThat(access.liveIds(1L)).isEmpty(); assertThat(resources.selectById(1L).getPublishScopeController()).isEqualTo("SYNC");
        long id = service.current(1L).publication().getRequestId();
        assertThat(service.synchronize(1L, null, false)).containsEntry("reason", "PRESERVED");
        assertThat(service.synchronize(1L, ResourcePublishScope.company(), false)).containsEntry("reason", "UNCHANGED");
        assertThat(service.current(1L).publication().getRequestId()).isEqualTo(id);
        var d = service.current(1L); service.withdraw(command(d, null, null));
        var local = submit("PUBLISH", orgs(100L));
        assertThat(service.synchronize(1L, orgs(200L), false)).containsEntry("reason", "IGNORED_LOCALLY_MANAGED");
        assertThat(service.current(1L).publication().getRequestId()).isEqualTo(local.publication().getRequestId());
    }
    @Test void scopedReviewerCannotSeeOrProcessOtherOrganizationsAndCountUsesCurrentRole() {
        var request = submit("PUBLISH", orgs(100L, 200L));
        login("reviewer", 20, 1); when(auth.isCurrentUserGlobalResourceManager()).thenReturn(false);
        when(admins.managedOrgIds()).thenReturn(Set.of(100L));
        var visible = service.detail(request.publication().getRequestId());
        assertThat(visible.targets()).hasSize(1); assertThat(visible.publication().getRequestedScopeJson()).isEqualTo("[\"100\"]");
        assertThat(visible.publishedScope()).isEmpty(); assertThat(visible.canManage()).isFalse();
        assertThatThrownBy(() -> service.review(command(visible, List.of(200L), true))).hasMessageContaining("无审核权限");
        assertThat(service.pendingCounts()).containsEntry("KG_DOC", 1L);
        when(admins.managedOrgIds()).thenReturn(Set.of());
        assertThat(service.pendingCount()).isZero(); assertThatThrownBy(() -> service.detail(request.publication().getRequestId())).hasMessageContaining("无权查看");
    }
    @Test void sameKeyCannotSilentlyChangePayloadAndListPaginationCountsEligibleRows() {
        var draft = prepare("PUBLISH", orgs(100L), "key");
        assertThat(prepare("PUBLISH", orgs(100L), "key").publication().getRequestId()).isEqualTo(draft.publication().getRequestId());
        assertThatThrownBy(() -> prepare("PUBLISH", orgs(200L), "key")).hasMessageContaining("幂等键");
        service.submit(command(draft, null, null));
        assertThat(service.list(true, 1, 20, List.of("KG_DOC")).total()).isEqualTo(1);
        assertThat(service.list(true, 1, 20, List.of("SKILL")).total()).isZero();
        jdbc.update("UPDATE ss_resource SET resource_status=-1 WHERE resource_id=1");
        assertThat(service.list(true, 1, 20, List.of("KG_DOC")).total()).isZero();
    }

    @Test void omittedOwnerCannotBypassCatalogScopeAndMetadataCannotBeForgedByJson() throws Exception {
        var query = new com.iwhalecloud.byai.manager.domain.resource.request.ResourceUseAuthQo();
        query.setResourceBizTypeList(List.of("SKILL")); access.prepareQuery(query);
        assertThat(query.getPublicationQuery()).isNotNull(); assertThat(query.getPublicationQuery().catalog()).isTrue();
        query.setAvailableOnly(true); access.prepareQuery(query); assertThat(query.getPublicationQuery().catalog()).isFalse();
        query.setResourceBizTypeList(List.of("DIG_EMPLOYEE")); access.prepareQuery(query); assertThat(query.getPublicationQuery()).isNull();
        var parsed = new com.fasterxml.jackson.databind.ObjectMapper().readValue("{\"publishScopeMode\":\"COMPANY\",\"publishScopeRevision\":99,\"publishScopeController\":\"SYNC\"}", SsResource.class);
        assertThat(parsed.getPublishScopeMode()).isNull(); assertThat(parsed.getPublishScopeRevision()).isNull(); assertThat(parsed.getPublishScopeController()).isNull();
    }

    @Test void rejectedSkillSnapshotCanBeRecreatedButPendingOrApprovedSnapshotCannot() {
        jdbc.update("UPDATE ss_resource SET resource_biz_type='SKILL' WHERE resource_id=1");
        var request = submit("PUBLISH", orgs(100L));
        assertThat(service.canPrepareNewSkillSnapshot(1L)).isFalse();
        service.review(command(request, List.of(100L), false)); assertThat(service.canPrepareNewSkillSnapshot(1L)).isTrue();
        var retry = submit("PUBLISH", orgs(100L)); service.review(command(retry, List.of(100L), true));
        assertThat(service.canPrepareNewSkillSnapshot(1L)).isFalse();
    }
    @Test void publishedAudienceUsesCurrentOrganizationTreeAndHardDeleteCleansPublicationRows() {
        var submitted = submit("PUBLISH", orgs(100L));
        assertThat(access.inAudience(resources.selectById(1L))).isFalse();
        service.review(command(submitted, List.of(100L), true));
        login("member", 30, 1);
        assertThat(access.inAudience(resources.selectById(1L))).isTrue();
        when(admins.userOrgIds(30L)).thenReturn(Set.of(200L));
        assertThat(access.inAudience(resources.selectById(1L))).isFalse();
        when(admins.userOrgIds(30L)).thenReturn(Set.of(101L));
        when(admins.allowedOrgIds()).thenReturn(Set.of(200L));
        when(organizations.selectList(isNull(), any())).thenReturn(List.of());
        assertThat(access.inAudience(resources.selectById(1L))).isFalse();
        resources.deleteById(1L);
        for (String table : List.of("resource_publication", "resource_publication_target", "resource_publish_scope"))
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class)).isZero();
    }

}
