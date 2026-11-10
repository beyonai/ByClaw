package com.iwhalecloud.byai.state.application.service.dataset;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.resource.ResourcePublicationAccess;
import com.iwhalecloud.byai.manager.application.service.resource.ResourcePublicationService;
import com.iwhalecloud.byai.manager.dto.resource.DatasetDto;
import com.iwhalecloud.byai.manager.dto.resource.ResourcePublishScope;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.KnowledgeProvisionTaskMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import org.apache.ibatis.mapping.Environment;
import org.junit.jupiter.api.*;
import org.mybatis.spring.SqlSessionTemplate;
import org.mybatis.spring.transaction.SpringManagedTransactionFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class KnowledgeProvisionServiceTest {
    KnowledgeProvisionService service;
    KnowledgeProviderService providers = mock(KnowledgeProviderService.class);
    DatasetApplicationService datasets = mock(DatasetApplicationService.class);
    ResourcePublicationService publications = mock(ResourcePublicationService.class);
    SsResourceMapper resources = mock(SsResourceMapper.class);
    JdbcTemplate jdbc;
    DatasetDto dto;
    @BeforeEach void setup() throws Exception {
        var login = new LoginInfo(); login.setEnterpriseId(1L); login.setUserId(10L); CurrentUserHolder.setLoginInfo(login);
        var ds = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;INIT=CREATE SCHEMA IF NOT EXISTS byai\\;SET SCHEMA byai");
        jdbc = new JdbcTemplate(ds);
        Path root = Path.of("").toAbsolutePath(); while (!Files.isDirectory(root.resolve("deploy/migrations"))) root = root.getParent();
        String ddl = Files.readString(root.resolve("deploy/migrations/versions/V0.6.0/V0.6.0__ddl.sql"));
        var statement = java.util.regex.Pattern.compile("CREATE TABLE byai.knowledge_provision_task \\(.*?\\);", java.util.regex.Pattern.DOTALL).matcher(ddl);
        assertThat(statement.find()).isTrue(); jdbc.execute(statement.group());
        var config = new MybatisConfiguration(); config.setEnvironment(new Environment("task", new SpringManagedTransactionFactory(), ds)); config.addMapper(KnowledgeProvisionTaskMapper.class);
        var session = new SqlSessionTemplate(new MybatisSqlSessionFactoryBuilder().build(config));
        var sequence = mock(SequenceService.class); var ids = new AtomicLong(100); when(sequence.nextVal()).thenAnswer(i -> ids.incrementAndGet());
        service = new KnowledgeProvisionService(session.getMapper(KnowledgeProvisionTaskMapper.class), resources, providers,
            mock(ResourcePublicationAccess.class), publications, sequence, new DataSourceTransactionManager(ds));
        ReflectionTestUtils.setField(service, "datasets", datasets);
        var advice = new com.iwhalecloud.byai.common.config.TransactionAdviceConfig();
        ReflectionTestUtils.setField(advice, "transactionManager", new DataSourceTransactionManager(ds));
        var proxy = new org.springframework.aop.framework.ProxyFactory(service); proxy.addAdvice(advice.getAdvisor());
        service = (KnowledgeProvisionService) proxy.getProxy();
        dto = new DatasetDto(); dto.setProviderId("77"); dto.setIdempotencyKey("one-create"); dto.setOwnerType("enterprise");
        dto.setResourceBizType("KG_DOC"); dto.setResourceName("Knowledge"); dto.setPublishScope(ResourcePublishScope.company());
        when(providers.provider("77")).thenReturn(new KnowledgeProviderService.Provider(new SsResource(), new com.alibaba.fastjson.JSONObject(), new com.alibaba.fastjson.JSONObject()));
        when(providers.create(any(), anyString(), anyString(), any())).thenReturn("remote-code");
        SsResource result = new SsResource(); result.setResourceId(5L); result.setCreateBy(10L); result.setComAcctId(1L); result.setResourceStatus(2);
        when(datasets.saveProvisionedDataset(any(), any(), eq("remote-code"))).thenReturn(result); when(resources.selectById(5L)).thenReturn(result);
    }
    @AfterEach void cleanup() { CurrentUserHolder.setLoginInfo(null); }
    @Test void duplicateRequestReturnsSameResourceAndNeverRepeatsExternalCreate() {
        assertThat(service.create(dto).getResourceId()).isEqualTo(5L);
        assertThat(service.create(dto).getResourceId()).isEqualTo(5L);
        verify(providers, times(1)).create(any(), anyString(), anyString(), any());
        verify(datasets, times(1)).saveProvisionedDataset(any(), any(), anyString());
        assertThat(jdbc.queryForObject("SELECT status FROM knowledge_provision_task", String.class)).isEqualTo("SUCCEEDED");
        dto.setResourceName("Different"); assertThatThrownBy(() -> service.create(dto)).hasMessageContaining("不同的建库请求");
    }
    @Test void timeoutIsDurableUnknownAndCannotRetryOrDeleteTheSource() {
        when(providers.create(any(), anyString(), anyString(), any())).thenThrow(new BaseException("timeout"));
        assertThatThrownBy(() -> service.create(dto)).hasMessageContaining("结果未知");
        assertThat(jdbc.queryForObject("SELECT status FROM knowledge_provision_task", String.class)).isEqualTo("UNKNOWN");
        assertThatThrownBy(() -> service.create(dto)).hasMessageContaining("不会重复创建");
        verify(providers, times(1)).create(any(), anyString(), anyString(), any()); verifyNoInteractions(datasets, publications);
    }
    @Test void confirmedExternalCodeSurvivesLocalTransactionRollback() {
        when(datasets.saveProvisionedDataset(any(), any(), anyString())).thenThrow(new BaseException("temporary database failure"));
        assertThatThrownBy(() -> service.create(dto)).hasMessageContaining("temporary");
        assertThat(jdbc.queryForObject("SELECT external_code FROM knowledge_provision_task", String.class)).isEqualTo("remote-code");
        assertThat(jdbc.queryForObject("SELECT status FROM knowledge_provision_task", String.class)).isEqualTo("PENDING");
        doReturn(resources.selectById(5L)).when(datasets).saveProvisionedDataset(any(), any(), anyString());
        assertThat(service.create(dto).getResourceId()).isEqualTo(5L); verify(providers, times(1)).create(any(), anyString(), anyString(), any());
    }
    @Test void publicationFailureKeepsResourceAndTaskSuccessful() {
        doThrow(new BaseException("review conflict")).when(publications).submitLocal(anyLong(), any());
        assertThat(service.create(dto).getPublicationError()).contains("发布尚未提交");
        assertThat(jdbc.queryForObject("SELECT status FROM knowledge_provision_task", String.class)).isEqualTo("SUCCEEDED");
        assertThat(service.create(dto).getResourceId()).isEqualTo(5L); verify(providers, times(1)).create(any(), anyString(), anyString(), any());
    }
    @Test void inFlightCreationCannotBeClaimedTwice() {
        when(providers.create(any(), anyString(), anyString(), any())).thenAnswer(i -> {
            assertThat(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            assertThatThrownBy(() -> service.create(dto)).hasMessageContaining("处理中或结果未知"); return "remote-code";
        });
        service.create(dto); verify(providers, times(1)).create(any(), anyString(), anyString(), any());
    }
    @Test void onlyExplicitCreateOperationAndConfirmedReturnedIdentityAreAccepted() {
        var root = com.alibaba.fastjson.JSON.parseObject("{\"resourceService\":[{\"action\":\"search\",\"path\":\"/search\"}]}");
        assertThat(KnowledgeProviderService.creationOperation(root)).isNull();
        root = com.alibaba.fastjson.JSON.parseObject("{\"resourceService\":[{\"action\":\"create_kb\",\"path\":\"/create\",\"method\":\"POST\"}]}");
        assertThat(KnowledgeProviderService.creationOperation(root)).isNotNull();
        var response = new com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlRunResult(); response.setSuccess(true);
        response.setBody("{\"resultCode\":\"0\",\"resultObject\":{\"knCode\":\"created\"}}");
        assertThat(KnowledgeProviderService.createdCode(response)).isEqualTo("created");
        response.setBody("{\"resultCode\":\"0\"}"); assertThatThrownBy(() -> KnowledgeProviderService.createdCode(response)).hasMessageContaining("未返回知识库编码");
        response.setBody("{\"resultCode\":\"1\",\"knCode\":\"wrong\"}"); assertThatThrownBy(() -> KnowledgeProviderService.createdCode(response)).hasMessageContaining("未确认");
    }
}
