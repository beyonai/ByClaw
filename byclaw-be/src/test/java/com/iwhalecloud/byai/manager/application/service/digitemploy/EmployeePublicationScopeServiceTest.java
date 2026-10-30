package com.iwhalecloud.byai.manager.application.service.digitemploy;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.organization.OrganizationAdminService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.entity.resource.DigitalEmployeePublication;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.EmployeePublicationTargetMapper;
import com.iwhalecloud.byai.manager.mapper.resource.EmployeePublishScopeMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.sql.DriverManager;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.*;

class EmployeePublicationScopeServiceTest {
    SqlSession session;
    SqlSessionFactory factory;
    EmployeePublicationScopeService service;
    OrganizationAdminService admins = mock(OrganizationAdminService.class);
    OrganizationService organizations = mock(OrganizationService.class);
    SequenceService sequence = mock(SequenceService.class);
    DigitalEmployeePublication publication;

    @BeforeEach void setup() throws Exception {
        login(8L);
        String url = "jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1";
        try (var connection = DriverManager.getConnection(url); var sql = connection.createStatement()) {
            sql.execute("CREATE SCHEMA byai");
            sql.execute("CREATE TABLE byai.digital_employee_publication_target (target_id BIGINT PRIMARY KEY, tenant_id BIGINT, request_id BIGINT, org_id BIGINT, org_name VARCHAR(255), status VARCHAR(16), revision BIGINT, reviewer_id BIGINT, reviewer_name VARCHAR(255), reviewed_at TIMESTAMP, comment VARCHAR(2000), created_at TIMESTAMP, UNIQUE(tenant_id,request_id,org_id))");
            sql.execute("CREATE TABLE byai.digital_employee_publish_scope (scope_id BIGINT PRIMARY KEY, tenant_id BIGINT, resource_id BIGINT, org_id BIGINT, request_id BIGINT, created_at TIMESTAMP, UNIQUE(tenant_id,resource_id,org_id))");
        }
        var config = new MybatisConfiguration(new Environment("scope", new JdbcTransactionFactory(),
            new UnpooledDataSource("org.h2.Driver", url, null, null)));
        config.addMapper(EmployeePublicationTargetMapper.class);
        config.addMapper(EmployeePublishScopeMapper.class);
        factory = new MybatisSqlSessionFactoryBuilder().build(config);
        session = factory.openSession(true);
        service = scopedService(session);
        AtomicLong ids = new AtomicLong(1000);
        when(sequence.nextVal()).thenAnswer(call -> ids.incrementAndGet());
        when(admins.allowedOrgIds()).thenReturn(Set.of(10L, 11L, 20L));
        when(admins.managedOrgIds()).thenReturn(Set.of(10L, 11L));
        when(organizations.findSelfAndDescendantOrgIds(10L)).thenReturn(List.of(10L, 11L));
        when(organizations.findSelfAndDescendantOrgIds(11L)).thenReturn(List.of(11L));
        when(organizations.findSelfAndDescendantOrgIds(20L)).thenReturn(List.of(20L));
        when(organizations.findById(anyLong())).thenAnswer(call -> {
            var org = new Organization(); org.setOrgId(call.getArgument(0)); org.setOrgName("Org " + call.getArgument(0)); return org;
        });
        publication = new DigitalEmployeePublication();
        publication.setRequestId(100L); publication.setTenantId(1L); publication.setStatus("DRAFT");
        publication.setRevision(1L);
    }

    EmployeePublicationScopeService scopedService(SqlSession sql) {
        return new EmployeePublicationScopeService(sql.getMapper(EmployeePublicationTargetMapper.class),
            sql.getMapper(EmployeePublishScopeMapper.class), admins, organizations, sequence);
    }

    void login(Long id) {
        LoginInfo info = new LoginInfo(); info.setUserId(id); info.setUserCode("reviewer" + id);
        info.setEnterpriseId(1L); info.setUsersOrganizations(List.of()); CurrentUserHolder.setLoginInfo(info);
    }

    @AfterEach void close() { if (session != null) session.close(); CurrentUserHolder.setLoginInfo(null); }

    @Test void organizationViewerOnlySeesOwnAndDescendantTargetsWhileDecisionsKeepAllTargets() {
        publication.setAuthorId(7L);
        service.configure(publication, List.of(11L, 20L)); publication.setStatus("PENDING");
        service.review(publication, List.of(11L), true, "A approved");
        assertThat(service.visibleTargets(publication)).extracting("orgId").containsExactly(11L);
        assertThat(service.canViewAllTargets(publication)).isFalse();
        assertThat(service.targets(publication)).extracting("orgId").containsExactly(11L, 20L);
        assertThat(service.allApproved(publication)).isFalse();
        assertThat(service.hasPending(publication)).isTrue();
        when(admins.managedOrgIds()).thenReturn(Set.of(20L)); login(9L);
        assertThat(service.visibleTargets(publication)).extracting("orgId").containsExactly(20L);
        assertThat(service.visibleTargets(publication).getFirst().getComment()).isNull();
        service.review(publication, List.of(20L), true, "B approved");
        assertThat(service.allApproved(publication)).isTrue();
        when(admins.managedOrgIds()).thenReturn(Set.of());
        assertThat(service.visibleTargets(publication)).isEmpty();
    }

    @Test void authorPlatformAndSuperAdminSeeAllTargetsButNeverAnotherTenant() {
        publication.setAuthorId(7L);
        service.configure(publication, List.of(10L, 20L));
        login(7L);
        assertThat(service.visibleTargets(publication)).hasSize(2);
        login(9L);
        var org = new com.iwhalecloud.byai.common.login.bean.UsersOrganization(); org.setUserType("PLAT_MAN");
        CurrentUserHolder.getLoginInfo().setUsersOrganizations(List.of(org));
        assertThat(service.visibleTargets(publication)).hasSize(2);
        login(9L); CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        assertThat(service.visibleTargets(publication)).hasSize(2);
        CurrentUserHolder.getLoginInfo().setEnterpriseId(2L);
        assertThat(service.canViewAllTargets(publication)).isFalse();
        assertThat(service.visibleTargets(publication)).isEmpty();
    }

    @Test void organizationAdminCannotSeeAnAllCompanyReviewTarget() {
        service.configure(publication, List.of(-1L)); publication.setAuthorId(7L);
        assertThat(service.visibleTargets(publication)).isEmpty();
        login(7L);
        assertThat(service.visibleTargets(publication)).extracting("orgId").containsExactly(-1L);
    }

    @Test void partialRejectionCanBeResubmittedWithoutReapprovingOrRemovingTheLiveOrganization() {
        service.configure(publication, List.of(10L, 20L));
        publication.setStatus("PENDING");
        service.review(publication, List.of(10L), true, "A approved");
        service.activate(publication, 900L);
        when(admins.managedOrgIds()).thenReturn(Set.of(20L));
        service.review(publication, List.of(20L), false, "B rejected");
        publication.setOfficialId(900L); publication.setStatus("REJECTED");
        var next = new DigitalEmployeePublication();
        next.setRequestId(101L); next.setTenantId(1L); next.setOfficialId(900L); next.setStatus("DRAFT");
        service.copy(publication, next);
        assertThat(service.targets(next)).extracting("status").containsExactly("APPROVED", "PENDING");
        assertThat(service.liveOrgIds(900L, 1L)).containsExactly(10L);
        assertThat(service.canView(next)).isFalse();
        next.setStatus("PENDING");
        assertThat(service.canView(next)).isTrue();
        service.review(next, List.of(20L), true, "B approved after resubmission");
        service.activate(next, 900L);
        assertThat(service.liveOrgIds(900L, 1L)).containsExactlyInAnyOrder(10L, 20L);
    }

    @Test void onlyTheApprovedOrganizationBecomesLive() {
        service.configure(publication, List.of(10L, 20L)); publication.setStatus("PENDING");
        service.review(publication, List.of(10L), true, "Approved A");
        service.activate(publication, 900L);
        assertThat(service.liveOrgIds(900L, 1L)).containsExactly(10L);
        assertThat(service.liveOrgIds(900L, 2L)).isEmpty();
        assertThat(service.targets(publication)).extracting("status").containsExactly("APPROVED", "PENDING");
        assertThat(service.canReview(publication)).isFalse();
        assertThatThrownBy(() -> service.review(publication, List.of(20L), true, "outside"))
            .hasMessageContaining("审核权限");
        when(admins.managedOrgIds()).thenReturn(Set.of(20L)); login(9L);
        service.review(publication, List.of(20L), true, "Approved B"); service.activate(publication, 900L);
        assertThat(service.liveOrgIds(900L, 1L)).containsExactlyInAnyOrder(10L, 20L);
        assertThat(service.allApproved(publication)).isTrue();
    }

    @Test void updateRequiresAllAlreadyPublishedOrganizationsAndKeepsTheOldAudience() {
        service.configure(publication, List.of(10L, 20L));
        when(admins.managedOrgIds()).thenReturn(Set.of(10L, 11L, 20L));
        service.review(publication, null, true, "initial"); service.activate(publication, 900L);
        var update = new DigitalEmployeePublication(); update.setRequestId(200L); update.setTenantId(1L);
        update.setOfficialId(900L); update.setScopeUpdate(true); update.setStatus("DRAFT");
        service.initialize(update);
        assertThatThrownBy(() -> service.configure(update, List.of(10L))).hasMessageContaining("全部已发布组织");
        when(admins.managedOrgIds()).thenReturn(Set.of(10L, 11L));
        service.review(update, List.of(10L), true, "new version");
        assertThat(service.allApproved(update)).isFalse();
        assertThat(service.liveOrgIds(900L, 1L)).containsExactlyInAnyOrder(10L, 20L);
        when(admins.managedOrgIds()).thenReturn(Set.of(20L)); login(9L);
        service.review(update, List.of(20L), true, "new version");
        assertThat(service.allApproved(update)).isTrue();
    }

    @Test void applicantReviewRequiresBothPublishedAudienceAndManagedMembership() {
        service.configure(publication, List.of(10L)); service.review(publication, null, true, null); service.activate(publication, 900L);
        when(admins.audienceMembers(List.of(10L))).thenReturn(new HashSet<>(Set.of(10L, 11L)));
        when(admins.userOrgIds(42L)).thenReturn(Set.of(11L));
        when(admins.userOrgIds(43L)).thenReturn(Set.of(20L));
        var employee = new SsResource(); employee.setResourceId(900L); employee.setResourceBizType("DIG_EMPLOYEE");
        employee.setOwnerType("enterprise"); employee.setComAcctId(1L);
        assertThat(service.canReviewApplicant(employee, 42L)).isTrue();
        assertThat(service.canReviewApplicant(employee, 43L)).isFalse();
        assertThat(service.canReviewApplicant(employee, 8L)).isFalse();
        employee.setOwnerType("personal"); assertThat(service.canReviewApplicant(employee, 42L)).isFalse();
        employee.setOwnerType("enterprise"); employee.setComAcctId(2L);
        assertThat(service.canReviewApplicant(employee, 42L)).isFalse();
    }

    @Test void scopeSelectionRejectsForeignOrOverlappingTargets() {
        assertThat(service.normalize(List.of(10L, 11L, 20L, 10L))).containsExactly(10L, 20L);
        assertThatThrownBy(() -> service.normalize(List.of(99L))).hasMessageContaining("当前企业");
        assertThatThrownBy(() -> service.normalize(List.of(-1L, 10L))).hasMessageContaining("不能");
        assertThatThrownBy(() -> service.normalize(List.of())).hasMessageContaining("请选择");
        service.configure(publication, List.of(-1L));
        assertThat(service.canReview(publication)).isFalse();
    }

    @Test void editingTheCandidateInvalidatesAllEarlierApprovals() {
        service.configure(publication, List.of(10L, 20L)); service.review(publication, List.of(10L), true, "old candidate");
        service.resetDecisions(publication);
        assertThat(service.targets(publication)).allSatisfy(target -> {
            assertThat(target.getStatus()).isEqualTo("PENDING"); assertThat(target.getReviewerId()).isNull();
        });
    }

    @Test void concurrentReviewersCanOnlyDecideATargetOnce() throws Exception {
        service.configure(publication, List.of(10L));
        CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            List<Future<Boolean>> results = new ArrayList<>();
            for (long id : List.of(8L, 9L)) results.add(pool.submit(() -> {
                login(id); start.await();
                try (SqlSession own = factory.openSession(true)) {
                    scopedService(own).review(publication, List.of(10L), true, "concurrent"); return true;
                } catch (com.iwhalecloud.byai.common.exception.BaseException processed) { return false; }
                finally { CurrentUserHolder.setLoginInfo(null); }
            }));
            start.countDown();
            assertThat(List.of(results.get(0).get(5, TimeUnit.SECONDS), results.get(1).get(5, TimeUnit.SECONDS)))
                .containsExactlyInAnyOrder(true, false);
        }
        session.clearCache();
        assertThat(service.targets(publication).getFirst().getRevision()).isEqualTo(1L);
    }
}
