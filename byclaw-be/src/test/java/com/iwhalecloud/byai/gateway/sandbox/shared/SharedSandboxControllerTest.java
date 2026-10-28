package com.iwhalecloud.byai.gateway.sandbox.shared;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.Map;
import java.util.List;
import java.util.LinkedHashMap;
import java.nio.file.Path;
import java.sql.DriverManager;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.io.TempDir;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class SharedSandboxControllerTest {
    @Mock private SharedSandboxGateway gateway;
    @Mock private UsersMapper users;
    @InjectMocks private SharedSandboxController controller;
    @TempDir Path directory;

    @BeforeEach
    void initializeUserMapping() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), Users.class);
    }

    @Test
    void ordinaryUserCannotReadOrMutateAdminResources() {
        try (var current = mockStatic(CurrentUserHolder.class)) {
            for (String operation : new String[] {"listRecords", "listMembers", "listConfigs", "saveConfig", "releaseInstance", "releaseMember"}) {
                assertThatThrownBy(() -> controller.call(operation, Map.of()))
                    .isInstanceOfSatisfying(ResponseStatusException.class, e -> assertThat(e.getStatusCode().value()).isEqualTo(403));
            }
            verifyNoInteractions(gateway);
        }
    }

    @Test
    void businessAdminCannotForgeAnotherTenantOrPlatformPrivileges() {
        try (var current = mockStatic(CurrentUserHolder.class)) {
            current.when(CurrentUserHolder::isBusinessAdmin).thenReturn(true);
            current.when(CurrentUserHolder::getEnterpriseId).thenReturn(7L);
            current.when(CurrentUserHolder::getCurrentUserCode).thenReturn("alice");
            controller.call("listMembers", Map.of("tenantScope", 9L, "enterpriseId", 9L,
                "platformManager", true, "userInfo", Map.of("userCode", "root")));
            verify(gateway).call(eq("listMembers"), argThat(p -> Long.valueOf(7).equals(p.get("tenantScope"))
                && Long.valueOf(7).equals(p.get("enterpriseId")) && Boolean.FALSE.equals(p.get("platformManager"))
                && !p.containsKey("userInfo") && "alice".equals(p.get("operatorUserCode"))));
            assertThatThrownBy(() -> controller.call("releaseInstance", Map.of()))
                .isInstanceOf(ResponseStatusException.class);
        }
    }

    @Test
    void platformAdminCanConfigureButCannotExposeAllocationThroughManagerProxy() {
        try (var current = mockStatic(CurrentUserHolder.class)) {
            current.when(CurrentUserHolder::isPlatformManager).thenReturn(true);
            controller.call("saveConfig", Map.of("serviceKey", "custom-host", "maxOnlineUsers", 10));
            verify(gateway).call(eq("saveConfig"), argThat(p -> "custom-host".equals(p.get("serviceKey"))));
            assertThatThrownBy(() -> controller.call("acquire", Map.of()))
                .isInstanceOfSatisfying(ResponseStatusException.class, e -> assertThat(e.getStatusCode().value()).isEqualTo(404));
        }
    }

    @Test
    void membersDefaultToActiveButExplicitEmptyStatusKeepsHistoryVisible() {
        try (var current = mockStatic(CurrentUserHolder.class)) {
            current.when(CurrentUserHolder::isPlatformManager).thenReturn(true);
            controller.call("listMembers", Map.of("userCodes", List.of("forged")));
            verify(gateway).call(eq("listMembers"), argThat(p -> "ACTIVE".equals(p.get("status"))
                && !p.containsKey("userCodes")));
            controller.call("listMembers", Map.of("status", ""));
            verify(gateway).call(eq("listMembers"), argThat(p -> "".equals(p.get("status"))));
        }
    }

    @Test
    void keywordIsResolvedBeforePaginationAndPageNamesAreBatchEnriched() {
        Users alice = new Users();
        alice.setUserId(42L);
        alice.setUserCode("alice001");
        alice.setUserName("艾丽丝");
        when(users.selectList(any(Wrapper.class))).thenReturn(List.of(alice));
        when(users.selectBatchIds(List.of(42L, 99L))).thenReturn(List.of(alice));
        when(gateway.call(eq("listMembers"), anyMap())).thenReturn(Map.of("records", List.of(
            Map.of("id", 10L, "userId", "42", "userCode", "alice001"),
            Map.of("id", 11L, "userId", 99L, "userCode", "deleted")), "total", 12L,
            "pageNum", 2, "pageSize", 2));
        try (var current = mockStatic(CurrentUserHolder.class)) {
            current.when(CurrentUserHolder::isBusinessAdmin).thenReturn(true);
            current.when(CurrentUserHolder::getEnterpriseId).thenReturn(7L);
            var response = controller.call("listMembers", Map.of("keyword", " 艾丽丝 ",
                "userCodes", List.of("forged"), "enterpriseId", 9L, "pageNum", 2, "pageSize", 2));
            verify(gateway).call(eq("listMembers"), argThat(p -> List.of("alice001").equals(p.get("userCodes"))
                && !p.containsKey("keyword") && Long.valueOf(7).equals(p.get("tenantScope"))
                && Integer.valueOf(2).equals(p.get("pageNum"))));
            Map<?, ?> page = (Map<?, ?>) response.getData();
            assertThat(page.get("total")).isEqualTo(12L);
            assertThat(page.get("pageNum")).isEqualTo(2);
            List<?> records = (List<?>) page.get("records");
            assertThat(((Map<?, ?>) records.get(0)).get("userName")).isEqualTo("艾丽丝");
            assertThat(((Map<?, ?>) records.get(1)).get("userName")).isNull();
        }
    }

    @Test
    void directorySearchMatchesUserCodeOrNameIncludingDisabledHistoricalUsers() throws Exception {
        String url = "jdbc:sqlite:" + directory.resolve("shared-member-users.sqlite");
        try (var connection = DriverManager.getConnection(url); var sql = connection.createStatement()) {
            sql.execute("CREATE TABLE po_users(user_id BIGINT, user_code TEXT, user_name TEXT, state TEXT)");
            sql.execute("INSERT INTO po_users VALUES (1,'alice001','艾丽丝','X'),"
                + "(2,'艾丽丝002','另一位用户','A'),(3,'bob003','鲍勃','A')");
        }
        var configuration = new MybatisConfiguration(new Environment("shared-members", new JdbcTransactionFactory(),
            new UnpooledDataSource("org.sqlite.JDBC", url, null, null)));
        configuration.addMapper(UsersMapper.class);
        try (var session = new MybatisSqlSessionFactoryBuilder().build(configuration).openSession();
            var current = mockStatic(CurrentUserHolder.class)) {
            current.when(CurrentUserHolder::isPlatformManager).thenReturn(true);
            SharedSandboxController realDirectory = new SharedSandboxController(gateway, session.getMapper(UsersMapper.class));
            realDirectory.call("listMembers", Map.of("keyword", " 艾丽丝 "));
            verify(gateway).call(eq("listMembers"), argThat(p -> List.of("alice001", "艾丽丝002").equals(p.get("userCodes"))));
        }
    }

    @Test
    void unmatchedKeywordCannotFallBackToUnfilteredMembers() {
        when(users.selectList(any(Wrapper.class))).thenReturn(List.of());
        try (var current = mockStatic(CurrentUserHolder.class)) {
            current.when(CurrentUserHolder::isPlatformManager).thenReturn(true);
            controller.call("listMembers", Map.of("keyword", "missing"));
            verify(gateway).call(eq("listMembers"), argThat(p -> List.of().equals(p.get("userCodes"))));
        }
    }

    @Test
    void manualReleaseUsesOnlyMappingFenceAndTrustedPlatformPrivileges() {
        try (var current = mockStatic(CurrentUserHolder.class)) {
            current.when(CurrentUserHolder::isPlatformManager).thenReturn(true);
            current.when(CurrentUserHolder::getCurrentUserCode).thenReturn("admin");
            Map<String, Object> input = new LinkedHashMap<>(Map.of("mappingId", "35951880-884a-48d7-a47b-e99b596e370d", "generation", 3,
                "userCode", "victim", "userId", 999L, "enterpriseId", 77L,
                "tenantScope", 77L, "force", false, "reason", "forged"));
            input.put("userInfo", Map.of("userCode", "victim"));
            assertThat(controller.call("releaseMember", input).getCode()).isZero();
            verify(gateway).call(eq("releaseMember"), argThat(p -> "35951880-884a-48d7-a47b-e99b596e370d".equals(p.get("mappingId"))
                && Integer.valueOf(3).equals(p.get("generation")) && Boolean.TRUE.equals(p.get("force"))
                && "manual".equals(p.get("reason")) && "admin".equals(p.get("operatorUserCode"))
                && Boolean.TRUE.equals(p.get("platformManager")) && !p.containsKey("tenantScope")
                && !p.containsKey("userCode") && !p.containsKey("userId") && !p.containsKey("userInfo")
                && !p.containsKey("enterpriseId")));
        }
    }

    @Test
    void businessAdminCannotReleaseMembersAndUnfencedReleaseIsRejected() {
        try (var current = mockStatic(CurrentUserHolder.class)) {
            current.when(CurrentUserHolder::isBusinessAdmin).thenReturn(true);
            assertThatThrownBy(() -> controller.call("releaseMember", Map.of("mappingId", "35951880-884a-48d7-a47b-e99b596e370d", "generation", 3)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                    e -> assertThat(e.getStatusCode().value()).isEqualTo(403));
            current.when(CurrentUserHolder::isPlatformManager).thenReturn(true);
            assertThatThrownBy(() -> controller.call("releaseMember", Map.of("mappingId", "35951880-884a-48d7-a47b-e99b596e370d")))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                    e -> assertThat(e.getStatusCode().value()).isEqualTo(400));
            verifyNoInteractions(gateway);
        }
    }

    @Test
    void releaseRejectsMissingMappingIdOrInvalidGeneration() {
        try (var current = mockStatic(CurrentUserHolder.class)) {
            current.when(CurrentUserHolder::isPlatformManager).thenReturn(true);
            for (Map<String, Object> input : List.<Map<String, Object>>of(
                Map.of("generation", 3),
                Map.of("mappingId", " ", "generation", 3),
                Map.of("mappingId", 8L, "generation", 3),
                Map.of("mappingId", "x".repeat(65), "generation", 3),
                Map.of("mappingId", "35951880-884a-48d7-a47b-e99b596e370d", "generation", 0),
                Map.of("mappingId", "35951880-884a-48d7-a47b-e99b596e370d", "generation", 1.5))) {
                assertThatThrownBy(() -> controller.call("releaseMember", input))
                    .isInstanceOfSatisfying(ResponseStatusException.class,
                        e -> assertThat(e.getStatusCode().value()).isEqualTo(400));
            }
            verifyNoInteractions(gateway);
        }
    }

}
