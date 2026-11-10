package com.iwhalecloud.byai.common.hook;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.embedded.EmbeddedDatabase;
import org.springframework.jdbc.datasource.embedded.EmbeddedDatabaseBuilder;
import org.springframework.jdbc.datasource.embedded.EmbeddedDatabaseType;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import static org.assertj.core.api.Assertions.assertThat;

/** 使用独立 H2 数据库验证启动装配，不依赖系统配置的 Redis 缓存。 */
class DatabaseHookConfigurationTest {
    private EmbeddedDatabase database;
    private JdbcTemplate jdbc;

    @BeforeEach void createDatabase() {
        database = new EmbeddedDatabaseBuilder().generateUniqueName(true).setType(EmbeddedDatabaseType.H2).build();
        jdbc = new JdbcTemplate(database);
        jdbc.execute("CREATE SCHEMA byai");
        jdbc.execute("CREATE TABLE byai.byai_system_config(param_code varchar(255), param_value text)");
    }

    @AfterEach void closeDatabase() {
        database.shutdown();
    }

    @Test void databaseDocumentEnablesHooksWithoutExternalProperties() {
        save("""
            byclaw:
              hooks:
                enabled: true
                subscriptions:
                  crm:
                    event: user.registered
                    http:
                      url: http://127.0.0.1:9/hook
            """);
        runner().run(context -> assertThat(context).hasNotFailed().hasSingleBean(HookDispatcher.class));
    }

    @Test void localPropertiesCannotEnableHooksWhenDatabaseConfigurationIsMissing() {
        runner().withPropertyValues("byclaw.hooks.enabled=true",
            "byclaw.hooks.subscriptions.crm.event=user.registered",
            "byclaw.hooks.subscriptions.crm.http.url=http://127.0.0.1:9/hook")
            .run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(context.getBeanProvider(HookDispatcher.class).getIfAvailable()).isNull();
            });
    }

    @Test void disabledDocumentDoesNotResolveMissingCredentialsOrAllocateWorkers() {
        save("""
            byclaw:
              hooks:
                enabled: ${ABSENT_HOOK_FLAG:false}
                subscriptions:
                  crm:
                    http:
                      url: ${ABSENT_HOOK_URL}
                      auth:
                        token: ${ABSENT_HOOK_SECRET}
            """);
        runner().withPropertyValues("byclaw.hooks.enabled=true").run(context -> {
            assertThat(context).hasNotFailed()
                .doesNotHaveBean(ThreadPoolTaskExecutor.class);
            assertThat(context.getBeanProvider(HookDispatcher.class).getIfAvailable()).isNull();
            assertThat(context.getBean(HookProperties.class).isEnabled()).isFalse();
        });
    }

    @Test void placeholdersUseEnvironmentDefaultsWithoutAllowingLocalSubscriptionOverrides() {
        save("""
            byclaw:
              hooks:
                enabled: ${DATABASE_HOOKS_ENABLED:false}
                defaults:
                  call-timeout: 15s
                subscriptions:
                  crm:
                    event: user.registered
                    http:
                      url: ${DATABASE_HOOK_URL:http://127.0.0.1:9/database}
                      auth:
                        type: bearer
                        token: ${DATABASE_HOOK_TOKEN}
            """);
        runner().withPropertyValues("DATABASE_HOOKS_ENABLED=true", "DATABASE_HOOK_TOKEN=test-token-with-\"quote",
            "byclaw.hooks.enabled=false", "byclaw.hooks.defaults.call-timeout=1s",
            "byclaw.hooks.subscriptions.crm.http.url=http://127.0.0.1:9/local")
            .run(context -> {
                assertThat(context).hasNotFailed().hasSingleBean(HookDispatcher.class);
                var properties = context.getBean(HookProperties.class);
                assertThat(properties.getDefaults().getCallTimeout()).isEqualTo(java.time.Duration.ofSeconds(15));
                var http = properties.getSubscriptions().get("crm").getHttp();
                assertThat(http.getUrl()).isEqualTo("http://127.0.0.1:9/database");
                assertThat(http.getAuth().getToken()).isEqualTo("test-token-with-\"quote");
            });
    }

    @Test void disabledSubscriptionMayRetainUnsetSecretPlaceholders() {
        save("""
            byclaw:
              hooks:
                enabled: true
                subscriptions:
                  disabled:
                    enabled: false
                    http:
                      url: ${ABSENT_HOOK_URL}
                      auth:
                        type: bearer
                        token: ${ABSENT_HOOK_SECRET}
            """);
        runner().run(context -> assertThat(context).hasNotFailed().hasSingleBean(HookDispatcher.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "byclaw: [malformed-private-test-material",
        "byclaw.hooks.enabled: true\nbyclaw.hooks.misspelled: private-test-material",
        "byclaw.hooks.enabled: invalid-private-test-material",
        "byclaw.hooks.enabled: true\nbyclaw.hooks.defaults.call-timeout: invalid-private-test-material",
        "byclaw.hooks.enabled: true\nbyclaw.hooks.defaults.call-timeout: 0s",
        "byclaw.hooks.enabled: true\nbyclaw.hooks.subscriptions.crm.event: private-test-material",
        "byclaw.hooks.enabled: true\nbyclaw.hooks.subscriptions.crm.event: user.registered\nbyclaw.hooks.subscriptions.crm.http.url: ${ABSENT_HOOK_URL}",
        "byclaw.hooks.enabled: true\nbyclaw.hooks.subscriptions.crm.event: user.registered\nbyclaw.hooks.subscriptions.crm.http.url: http://127.0.0.1:9/hook\nbyclaw.hooks.subscriptions.crm.http.auth.type: bearer\nbyclaw.hooks.subscriptions.crm.http.auth.token: ${ABSENT_HOOK_SECRET}",
        "byclaw.hooks.enabled: false\n---\nbyclaw.hooks.enabled: true",
        "byclaw.hooks.enabled: true\nbyclaw.hooks.enabled: false",
        "spring.datasource.password: private-test-material",
        "", "# no document"
    })
    void invalidDocumentsAbortStartupWithoutExposingConfigurationValues(String yaml) {
        save(yaml);
        runner().run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure()).hasStackTraceContaining("BYCLAW_HOOKS_CONFIG")
                .hasStackTraceContaining("IllegalStateException");
            assertThat(org.apache.commons.lang3.exception.ExceptionUtils.getStackTrace(context.getStartupFailure()))
                .doesNotContain("private-test-material");
        });
    }

    @Test void duplicateRowsAbortStartupInsteadOfSelectingAnArbitraryConfiguration() {
        save("byclaw.hooks.enabled: false");
        save("byclaw.hooks.enabled: true");
        runner().run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure()).hasStackTraceContaining("exactly one BYCLAW_HOOKS_CONFIG");
        });
    }

    @Test void databaseErrorsAbortStartupWithoutFallingBackToLocalYaml() {
        jdbc.execute("DROP TABLE byai.byai_system_config");
        runner().withPropertyValues("byclaw.hooks.enabled=false").run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure()).hasStackTraceContaining("Cannot read BYCLAW_HOOKS_CONFIG");
        });
    }

    @Test void databaseChangesRequireANewApplicationContext() {
        save("byclaw.hooks.enabled: false");
        runner().run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBeanProvider(HookDispatcher.class).getIfAvailable()).isNull();
            jdbc.update("UPDATE byai.byai_system_config SET param_value=?", "byclaw.hooks.enabled: true");
            assertThat(context.getBean(HookProperties.class).isEnabled()).isFalse();
        });
        runner().run(context -> assertThat(context).hasNotFailed().hasSingleBean(HookDispatcher.class));
    }

    @Test void literalBodiesPreserveNullCollectionsAndQuotedScalars() {
        save("""
            byclaw:
              hooks:
                enabled: true
                subscriptions:
                  crm:
                    event: user.registered
                    http:
                      url: http://127.0.0.1:9/hook
                      body:
                        nullable:
                          value: null
                        sequence:
                          value: [12, true, '03']
                        object:
                          value: {a: 7}
            """);
        runner().run(context -> {
            assertThat(context).hasNotFailed();
            var body = context.getBean(HookProperties.class).getSubscriptions().get("crm").getHttp().getBody();
            assertThat(body.get("nullable").isValuePresent()).isTrue();
            assertThat(body.get("nullable").getValue()).isNull();
            assertThat(body.get("sequence").getValue()).isEqualTo(java.util.List.of(12, true, "03"));
            assertThat(body.get("object").getValue()).isEqualTo(java.util.Map.of("a", 7));
        });
    }

    @Test void disabledSubscriptionsDoNotResolveCircularCredentialPlaceholders() {
        save("""
            byclaw.hooks.enabled: true
            byclaw.hooks.subscriptions.disabled.enabled: false
            byclaw.hooks.subscriptions.disabled.http.auth.token: ${CYCLIC_HOOK_SECRET}
            """);
        runner().withPropertyValues("CYCLIC_HOOK_SECRET=${CYCLIC_HOOK_SECRET}")
            .run(context -> assertThat(context).hasNotFailed());
    }

    @Test void enabledBodyConstantsRejectUnresolvedPlaceholders() {
        save("""
            byclaw.hooks.enabled: true
            byclaw.hooks.subscriptions.crm.event: user.registered
            byclaw.hooks.subscriptions.crm.http.url: http://127.0.0.1:9/hook
            byclaw.hooks.subscriptions.crm.http.body.reference.value: ${ABSENT_BODY_CONSTANT}
            """);
        runner().run(context -> assertThat(context).hasFailed());
    }

    @Test void debugYamlLoggingDoesNotExposeStoredCredentials() {
        var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory
            .getLogger("org.springframework.boot.env.OriginTrackedYamlLoader");
        var previousLevel = logger.getLevel();
        var captured = new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        captured.start();
        logger.addAppender(captured);
        logger.setLevel(ch.qos.logback.classic.Level.DEBUG);
        try {
            save("""
                byclaw.hooks.enabled: false
                byclaw.hooks.subscriptions.crm.http.auth.token: pretend-private-hook-credential
                """);
            runner().run(context -> assertThat(context).hasNotFailed());
            assertThat(captured.list).noneMatch(event -> event.getFormattedMessage().contains("pretend-private-hook-credential"));
        } finally {
            logger.detachAppender(captured);
            logger.setLevel(previousLevel);
            captured.stop();
        }
    }

    @Test void jsonExampleLoadsDirectlyFromTheDatabaseForFrontendEditing() throws Exception {
        save(java.nio.file.Files.readString(java.nio.file.Path.of("config/examples/hooks.json")));
        runner().withPropertyValues("BYCLAW_HOOKS_ENABLED=true",
            "REGISTRATION_HOOK_URL=http://127.0.0.1:9/json", "REGISTRATION_HOOK_TOKEN=json-test-token")
            .run(context -> {
                assertThat(context).hasNotFailed().hasSingleBean(HookDispatcher.class);
                var http = context.getBean(HookProperties.class).getSubscriptions().get("registration-crm").getHttp();
                assertThat(http.getUrl()).isEqualTo("http://127.0.0.1:9/json");
                assertThat(http.getAuth().getToken()).isEqualTo("json-test-token");
            });
    }

    @Test void hacuJsonPreservesTheThreeOriginalSubscriptionsAndSigningProtocol() throws Exception {
        save(java.nio.file.Files.readString(java.nio.file.Path.of("config/examples/hacu-api-hooks.json")));
        runner().withUserConfiguration(
                com.iwhalecloud.byai.manager.domain.tenant.hook.TenantHookConfiguration.class,
                com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook.WorkgroupHooks.class,
                com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook.MemberJoinedHook.class)
            .withPropertyValues("BYCLAW_HOOKS_ENABLED=true", "HACU_API_BASE_URL=http://127.0.0.1:9",
                "HACU_API_HOOK_SECRET=hacu-test-only-signing-material-at-least-32chars")
            .run(context -> {
                assertThat(context).hasNotFailed().hasSingleBean(HookDispatcher.class);
                var properties = context.getBean(HookProperties.class);
                assertThat(properties.getDefaults().getCallTimeout()).isEqualTo(java.time.Duration.ofSeconds(15));
                assertThat(properties.getSubscriptions()).containsOnlyKeys("hacu-tenant", "hacu-workgroup", "hacu-workgroup-member");
                var tenant = properties.getSubscriptions().get("hacu-tenant");
                var group = properties.getSubscriptions().get("hacu-workgroup");
                var member = properties.getSubscriptions().get("hacu-workgroup-member");
                assertThat(tenant.getEvent()).isEqualTo("tenant.created");
                assertThat(group.getEvent()).isEqualTo("workgroup.created");
                assertThat(member.getEvent()).isEqualTo("workgroup.member.joined");
                assertThat(tenant.getRetry().getMaxAttempts()).isEqualTo(5);
                assertThat(group.getRetry().getMaxAttempts()).isEqualTo(5);
                assertThat(member.getRetry().getMaxAttempts()).isEqualTo(12);
                assertThat(member.getRetry().getDelay()).isEqualTo(java.time.Duration.ofSeconds(10));
                assertThat(group.getRequiredDataFields()).containsExactly("enterpriseId");
                assertThat(member.getRequiredDataFields()).containsExactly("enterpriseId");
                properties.getSubscriptions().values().forEach(subscription -> {
                    var auth = subscription.getHttp().getAuth();
                    assertThat(auth.getType()).isEqualTo("hmac-sha256");
                    assertThat(auth.getClientId()).isEqualTo("byai-service");
                    assertThat(auth.getCanonicalFields()).hasSize(9);
                    assertThat(auth.getCanonicalFields().getFirst().getValue()).isEqualTo("hacu-api-access-v1");
                    assertThat(auth.getHeaders()).containsOnlyKeys(
                        "X-Hacu-Client", "X-Hacu-Timestamp", "X-Hacu-Nonce", "X-Hacu-Signature");
                });
            });
    }

    @Test void hookEnablementDoesNotReplaceTheExistingDefaultAsyncExecutor() {
        save("byclaw.hooks.enabled: ${HOOK_EXECUTOR_TEST_ENABLED:false}");
        for (boolean enabled : new boolean[] {false, true}) {
            runner().withUserConfiguration(com.iwhalecloud.byai.manager.config.AsyncConfig.class)
                .withPropertyValues("HOOK_EXECUTOR_TEST_ENABLED=" + enabled).run(context -> {
                    assertThat(context).hasNotFailed();
                    var executor = context.getBean("taskExecutor", ThreadPoolTaskExecutor.class);
                    assertThat(context.getBean("defaultAsyncExecutor")).isSameAs(executor);
                    assertThat(executor.submit(() -> Thread.currentThread().getName()).get(5, java.util.concurrent.TimeUnit.SECONDS))
                        .startsWith("default-async-");
                    if (enabled) {
                        assertThat(context.getBean("hookExecutor")).isNotSameAs(executor);
                    }
                });
        }
    }

    private ApplicationContextRunner runner() {
        return new ApplicationContextRunner()
            .withUserConfiguration(HookConfiguration.class, HookIntegrationTest.SchemaConfiguration.class)
            .withBean(JdbcTemplate.class, () -> jdbc);
    }

    private void save(String yaml) {
        jdbc.update("INSERT INTO byai.byai_system_config(param_code,param_value) VALUES (?,?)", "BYCLAW_HOOKS_CONFIG", yaml);
    }
}
