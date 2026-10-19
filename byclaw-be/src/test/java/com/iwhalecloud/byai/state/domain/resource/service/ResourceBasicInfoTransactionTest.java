package com.iwhalecloud.byai.state.domain.resource.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.common.config.TransactionAdviceConfig;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceArtifactService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceArtifact;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceArtifactMapper;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;

/** 通过真实全局事务代理及行更新，覆盖普通技能两次登记同一产物时的事务自等待。 */
class ResourceBasicInfoTransactionTest {
    private JdbcTemplate jdbc;
    private TransactionAdviceConfig config;
    private ToolManService service;
    private ResourceArtifactStorageService storage;

    @BeforeEach
    void setup() {
        var dataSource = new DriverManagerDataSource(
            "jdbc:h2:mem:" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=200");
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("CREATE TABLE resource_record(id BIGINT PRIMARY KEY, name VARCHAR(100))");
        jdbc.execute("CREATE TABLE artifact(id BIGINT PRIMARY KEY, remark VARCHAR(100))");
        jdbc.update("INSERT INTO resource_record VALUES(1, 'Original')");
        jdbc.update("INSERT INTO artifact VALUES(10, 'Original')");
        config = new TransactionAdviceConfig();
        ReflectionTestUtils.setField(config, "transactionManager", new DataSourceTransactionManager(dataSource));

        LoginInfo login = new LoginInfo();
        login.setUserId(1L);
        login.setUserCode("adminvip");
        CurrentUserHolder.setLoginInfo(login);

        var mapper = mock(SsResourceArtifactMapper.class);
        when(mapper.selectOne(any())).thenAnswer(call -> {
            var artifact = new SsResourceArtifact();
            artifact.setArtifactId(10L);
            artifact.setRemark(jdbc.queryForObject("SELECT remark FROM artifact WHERE id=10", String.class));
            return artifact;
        });
        when(mapper.updateById(any(SsResourceArtifact.class))).thenAnswer(call -> {
            SsResourceArtifact artifact = call.getArgument(0);
            return jdbc.update("UPDATE artifact SET remark=? WHERE id=?", artifact.getRemark(), artifact.getArtifactId());
        });
        var artifactTarget = new SsResourceArtifactService();
        ReflectionTestUtils.setField(artifactTarget, "ssResourceArtifactMapper", mapper);
        ReflectionTestUtils.setField(artifactTarget, "resourceArtifactPathResolver", new ResourceArtifactPathResolver());
        var artifacts = proxy(artifactTarget);

        var resource = new SsResource();
        resource.setResourceId(1L);
        resource.setResourceBizType("SKILL");
        resource.setResourceStatus(2);
        resource.setOwnerType("personal");
        var resources = mock(SsResourceService.class);
        when(resources.findByIdForUpdate(1L)).thenReturn(resource);
        when(resources.updateResourceEntity(resource)).thenAnswer(call -> {
            jdbc.update("UPDATE resource_record SET name=? WHERE id=1", resource.getResourceName());
            return resource;
        });
        var auth = mock(AuthApplicationService.class);
        when(auth.hasResourceManagePermission(resource)).thenReturn(true);
        var skills = mock(ByClawSkillResourceApplicationService.class);
        when(skills.refreshSkillBasicInfo(resource)).thenAnswer(call -> {
            // 普通技能 refreshSkillBasicInfo 通过此入口先登记 STANDARD_JSON，持有当前事务的写锁。
            artifacts.upsertArtifact(1L, "SKILL", "STANDARD_JSON", "minio", "skill/SKILL_1.json", "skill-refresh");
            return "{\"resourceId\":1}";
        });
        storage = mock(ResourceArtifactStorageService.class);
        var target = new ToolManService();
        ReflectionTestUtils.setField(target, "ssResourceService", resources);
        ReflectionTestUtils.setField(target, "authApplicationService", auth);
        ReflectionTestUtils.setField(target, "byClawSkillResourceApplicationService", skills);
        ReflectionTestUtils.setField(target, "resourceArtifactStorageService", storage);
        ReflectionTestUtils.setField(target, "ssResourceArtifactService", artifacts);
        service = proxy(target);
    }

    @AfterEach
    void cleanup() {
        CurrentUserHolder.setLoginInfo(null);
    }

    @Test
    void skillSaveCompletesWhenTheArtifactWasAlreadyWrittenInTheSameTransaction() {
        service.updateResourceBasicInfo(1L, "Updated", "Description", null, null);
        assertThat(jdbc.queryForObject("SELECT name FROM resource_record WHERE id=1", String.class)).isEqualTo("Updated");
        assertThat(jdbc.queryForObject("SELECT remark FROM artifact WHERE id=10", String.class)).isEqualTo("resource-basic-info-sync");
    }

    @Test
    void failedSyncRollsBackBothResourceAndArtifactChanges() {
        doThrow(new IllegalStateException("Storage unavailable"))
            .when(storage).syncResourceJsonByBizType(anyString(), eq("SKILL"), eq(1L));
        assertThatThrownBy(() -> service.updateResourceBasicInfo(1L, "Updated", "Description", null, null))
            .isInstanceOf(IllegalStateException.class).hasMessage("Storage unavailable");
        assertThat(jdbc.queryForObject("SELECT name FROM resource_record WHERE id=1", String.class)).isEqualTo("Original");
        assertThat(jdbc.queryForObject("SELECT remark FROM artifact WHERE id=10", String.class)).isEqualTo("Original");
    }

    @SuppressWarnings("unchecked")
    private <T> T proxy(T target) {
        var factory = new ProxyFactory(target);
        factory.setProxyTargetClass(true);
        factory.addAdvice(config.getAdvisor());
        return (T) factory.getProxy();
    }
}
