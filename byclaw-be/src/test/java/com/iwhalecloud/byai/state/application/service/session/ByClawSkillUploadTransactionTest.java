package com.iwhalecloud.byai.state.application.service.session;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.state.interfaces.controller.resource.ToolManController;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ByClawSkillUploadTransactionTest extends I18nTestSupport {
    private static final String ROOT = "/.openclaw/workspace-baiying-agent-9/skills/";
    private final Map<String, String> files = new LinkedHashMap<>();
    private final AtomicInteger failWrite = new AtomicInteger(-1);
    private final UserFS fs = mock(UserFS.class);
    private final SsResourceService resources = mock(SsResourceService.class);
    private ByClawSkillUploadApplicationService uploader;
    private ByClawSkillResourceApplicationService registration;
    private ByClawSkillResourceApplicationService proxy;
    private TransactionTemplate tx;
    private JdbcTemplate jdbc;

    @BeforeEach void setUp() throws Exception {
        LoginInfo login = new LoginInfo(); login.setUserId(7L); login.setUserCode("uploader"); login.setEnterpriseId(1L);
        CurrentUserHolder.setLoginInfo(login);
        var source = new DriverManagerDataSource("jdbc:h2:mem:upload_" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1", "sa", "");
        jdbc = new JdbcTemplate(source); jdbc.execute("CREATE TABLE registration (name VARCHAR(255))");
        var manager = new DataSourceTransactionManager(source); tx = new TransactionTemplate(manager);
        var paths = mock(ByClawSkillPathResolver.class);
        when(paths.resolveSkillRootPrefix(anyString(), any())).thenReturn(ROOT);
        uploader = new ByClawSkillUploadApplicationService();
        ReflectionTestUtils.setField(uploader, "userFS", fs);
        ReflectionTestUtils.setField(uploader, "skillPathResolver", paths);
        when(fs.list(anyString(), eq(Integer.MAX_VALUE))).thenAnswer(call -> files.keySet().stream()
            .filter(path -> path.startsWith(call.getArgument(0))).toList());
        when(fs.read(anyString())).thenAnswer(call -> new ByteArrayInputStream(files.get(call.getArgument(0)).getBytes(StandardCharsets.UTF_8)));
        when(fs.delete(anyString())).thenAnswer(call -> {
            String prefix = call.getArgument(0); files.keySet().removeIf(path -> path.startsWith(prefix)); return true;
        });
        when(fs.write(any(InputStream.class), anyLong(), anyString(), anyString())).thenAnswer(call -> {
            if (failWrite.getAndDecrement() == 0) throw new IllegalStateException("injected file write failure");
            files.put(call.getArgument(3), new String(((InputStream) call.getArgument(0)).readAllBytes(), StandardCharsets.UTF_8));
            return null;
        });
        registration = spy(new ByClawSkillResourceApplicationService());
        ReflectionTestUtils.setField(registration, "byClawSkillUploadApplicationService", uploader);
        ReflectionTestUtils.setField(registration, "ssResourceService", resources);
        doNothing().when(registration).validateChatUploadedSkillImportPermission(any(), any());
        doAnswer(call -> { jdbc.update("INSERT INTO registration VALUES ('skill')"); return null; })
            .when(registration).registerChatUploadedSkills(anyString(), any(), any(), any());
        ProxyFactory factory = new ProxyFactory(registration);
        factory.addAdvice(new TransactionInterceptor(manager, new AnnotationTransactionAttributeSource()));
        proxy = (ByClawSkillResourceApplicationService) factory.getProxy();
    }

    @AfterEach void tearDown() { CurrentUserHolder.clearLoginInfo(); jdbc.execute("SHUTDOWN"); }

    @Test void laterRegistrationFailureRestoresOldScriptsAndRollsBackDatabaseThroughController() throws Exception {
        files.put(ROOT + "alpha/SKILL.md", "old document");
        files.put(ROOT + "alpha/deep/a/b/c/run.py", "old script");
        Map<String, String> original = new LinkedHashMap<>(files);
        doAnswer(call -> { jdbc.update("INSERT INTO registration VALUES ('failed')"); throw new IllegalStateException("registration failed"); })
            .when(registration).registerChatUploadedSkills(anyString(), any(), any(), any());
        var restoredBeforeUnlock = new java.util.concurrent.atomic.AtomicBoolean();
        doAnswer(call -> {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public int getOrder() { return org.springframework.core.Ordered.HIGHEST_PRECEDENCE; }
                @Override public void afterCompletion(int status) {
                    assertThat(files).isEqualTo(original); restoredBeforeUnlock.set(true);
                }
            });
            return null;
        }).when(resources).lockSkillImport(anyString());
        ToolManController controller = new ToolManController();
        ReflectionTestUtils.setField(controller, "byClawSkillResourceApplicationService", proxy);
        controller.uploadSkillZip(zip("alpha", "new document"), null, 9L, null);
        assertThat(files).isEqualTo(original);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM registration", Integer.class)).isZero();
        assertThat(restoredBeforeUnlock).isTrue();
    }

    @Test void partialWriteFailureRestoresEverySkillInBatchAndDeletesNewFiles() throws Exception {
        files.put(ROOT + "alpha/SKILL.md", "old document");
        files.put(ROOT + "alpha/old.py", "old script");
        files.put(ROOT + "unrelated/keep", "keep");
        Map<String, String> original = new LinkedHashMap<>(files);
        failWrite.set(1); // alpha is replaced, beta fails on its first file.
        assertThatThrownBy(() -> proxy.uploadAndRegisterChatSkills("uploader", 9L,
            List.of(zip("alpha", "new"), zip("beta", "new beta")))).hasMessageContaining("file write failure");
        assertThat(files).isEqualTo(original);
        verify(registration, never()).registerChatUploadedSkills(anyString(), any(), any(), any());
    }

    @Test void failureReadingOldContentNeverDeletesAnything() throws Exception {
        files.put(ROOT + "alpha/SKILL.md", "old");
        doThrow(new IllegalStateException("read failed")).when(fs).read(anyString());
        assertThatThrownBy(() -> uploader.uploadSkillZip("uploader", 9L, zip("alpha", "new"))).hasMessage("read failed");
        assertThat(files).containsEntry(ROOT + "alpha/SKILL.md", "old");
        verify(fs, never()).delete(anyString());
    }

    @Test void invalidLaterPackageDoesNotChangeEarlierSkills() throws Exception {
        files.put(ROOT + "alpha/SKILL.md", "old");
        assertThatThrownBy(() -> uploader.uploadSkillZips("uploader", 9L,
            List.of(zip("alpha", "new"), new MockMultipartFile("file", "bad.zip", "application/zip", new byte[0]))))
            .isInstanceOf(IllegalArgumentException.class);
        verify(fs, never()).delete(anyString());
        assertThat(files).containsEntry(ROOT + "alpha/SKILL.md", "old");
    }

    @Test void repeatedReplacementInOneRolledBackTransactionRestoresTheOriginalVersion() throws Exception {
        files.put(ROOT + "alpha/SKILL.md", "original");
        var first = zip("alpha", "first"); var second = zip("alpha", "second");
        tx.executeWithoutResult(status -> {
            uploader.prepareTransactionRollback();
            uploader.uploadSkillZip("uploader", 9L, first);
            uploader.uploadSkillZip("uploader", 9L, second);
            status.setRollbackOnly();
        });
        assertThat(files).containsOnly(entry(ROOT + "alpha/SKILL.md", "original"));
    }

    @Test void successfulRegistrationCommitsAndRemovesObsoleteFiles() throws Exception {
        files.put(ROOT + "alpha/SKILL.md", "old"); files.put(ROOT + "alpha/obsolete", "remove me");
        var result = proxy.uploadAndRegisterChatSkills("uploader", 9L, List.of(zip("alpha", "new")));
        assertThat(result).hasSize(1);
        assertThat(files).containsOnly(entry(ROOT + "alpha/SKILL.md", "new"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM registration", Integer.class)).isEqualTo(1);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"standalone", "cluster"})
    void lostImportLeaseRestoresWorkspaceAndDatabaseAndAllowsRetry(String mode) throws Exception {
        String port = System.getenv("cluster".equals(mode) ? "BYCLAW_TEST_REDIS_CLUSTER_PORT" : "BYCLAW_TEST_REDIS_PORT");
        org.junit.jupiter.api.Assumptions.assumeTrue(port != null && port.matches("[0-9]+"));
        var connection = "cluster".equals(mode)
            ? new org.springframework.data.redis.connection.jedis.JedisConnectionFactory(
                new org.springframework.data.redis.connection.RedisClusterConfiguration(List.of("127.0.0.1:" + port)))
            : new org.springframework.data.redis.connection.jedis.JedisConnectionFactory(
                new org.springframework.data.redis.connection.RedisStandaloneConfiguration("127.0.0.1", Integer.parseInt(port)));
        connection.afterPropertiesSet(); connection.start();
        String prefix = "test:upload:" + UUID.randomUUID();
        var registry = new org.springframework.integration.redis.util.RedisLockRegistry(connection, prefix);
        var locks = new com.iwhalecloud.byai.manager.domain.resource.service.SkillImportLockService(registry);
        doAnswer(call -> { locks.acquire(call.getArgument(0)); return null; }).when(resources).lockSkillImport(anyString());
        files.put(ROOT + "alpha/SKILL.md", "original");
        doAnswer(call -> {
            jdbc.update("INSERT INTO registration VALUES ('failed')");
            try (var client = connection.getConnection()) {
                client.keyCommands().del((prefix + ":alpha").getBytes(StandardCharsets.UTF_8));
            }
            return null;
        }).when(registration).registerChatUploadedSkills(anyString(), any(), any(), any());
        try {
            assertThatThrownBy(() -> proxy.uploadAndRegisterChatSkills("uploader", 9L, List.of(zip("alpha", "new"))))
                .isInstanceOf(IllegalStateException.class);
            assertThat(files).containsOnly(entry(ROOT + "alpha/SKILL.md", "original"));
            assertThat(jdbc.queryForObject("SELECT count(*) FROM registration", Integer.class)).isZero();
            doAnswer(call -> { jdbc.update("INSERT INTO registration VALUES ('retry')"); return null; })
                .when(registration).registerChatUploadedSkills(anyString(), any(), any(), any());
            proxy.uploadAndRegisterChatSkills("uploader", 9L, List.of(zip("alpha", "retried")));
            assertThat(files).containsOnly(entry(ROOT + "alpha/SKILL.md", "retried"));
            assertThat(jdbc.queryForObject("SELECT count(*) FROM registration", Integer.class)).isEqualTo(1);
        } finally {
            registry.destroy(); connection.destroy();
        }
    }

    private MockMultipartFile zip(String name, String content) throws Exception {
        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes)) {
            zip.putNextEntry(new ZipEntry(name + "/SKILL.md")); zip.write(content.getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
        }
        return new MockMultipartFile("file", name + ".zip", "application/zip", bytes.toByteArray());
    }
}
