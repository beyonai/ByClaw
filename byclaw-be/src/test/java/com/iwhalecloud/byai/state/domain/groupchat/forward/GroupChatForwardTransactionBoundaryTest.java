package com.iwhalecloud.byai.state.domain.groupchat.forward;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.config.TransactionAdviceConfig;
import com.iwhalecloud.byai.common.storage.impl.LocalStorageService;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import java.nio.file.Files;
import java.nio.file.Path;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.GroupChatForwardCommitService;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.aop.support.AopUtils;
import org.springframework.aop.framework.autoproxy.DefaultAdvisorAutoProxyCreator;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.BeanFactoryTransactionAttributeSourceAdvisor;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.*;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Real Spring name/annotation auto-proxies, real JDBC boundaries and real loopback SDK I/O. */
class GroupChatForwardTransactionBoundaryTest {
    @org.junit.jupiter.api.io.TempDir Path directory;
    static boolean active() { return TransactionSynchronizationManager.isActualTransactionActive(); }
    static GenericApplicationContext context(DataSourceTransactionManager manager) {
        var context = new GenericApplicationContext();
        var config = new TransactionAdviceConfig(); ReflectionTestUtils.setField(config,"transactionManager",manager);
        context.registerBean("transactionManager",DataSourceTransactionManager.class,()->manager);
        context.registerBean("txAdvice",TransactionInterceptor.class,config::getAdvisor);
        context.registerBean("txProxy",org.springframework.aop.framework.autoproxy.BeanNameAutoProxyCreator.class,config::txProxy);
        // Same annotation advisor as @EnableTransactionManagement, alongside the production global name advisor.
        context.registerBean("annotationProxy",DefaultAdvisorAutoProxyCreator.class,()->{var p=new DefaultAdvisorAutoProxyCreator();p.setProxyTargetClass(true);return p;});
        context.registerBean("annotationTransactionAdvisor",BeanFactoryTransactionAttributeSourceAdvisor.class,()->{
            var source=new AnnotationTransactionAttributeSource();var advisor=new BeanFactoryTransactionAttributeSourceAdvisor();
            advisor.setTransactionAttributeSource(source);advisor.setAdvice(new TransactionInterceptor(manager,source));return advisor;
        });
        return context;
    }

    @Test void knowledgeMetadataPermissionNodeTransportAndDownloadUseTheRealSuspendedProxyChain() throws Exception {
        var manager=new DataSourceTransactionManager(new DriverManagerDataSource("jdbc:h2:mem:proxy"+System.nanoTime(),"sa",""));
        byte[] file="knowledge-file".getBytes(StandardCharsets.UTF_8);var requests=new AtomicInteger();var boundaries=new AtomicInteger();
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/",exchange->{
            requests.incrementAndGet();String path=exchange.getRequestURI().getPath();String response;
            if(path.endsWith("health/ready"))response="{\"ready\":true,\"enterpriseId\":\"123\",\"generation\":\"1\",\"dbSandboxRecordId\":\"987\"}";
            else if(path.endsWith("project-access"))response="{\"bound\":true,\"canRead\":true}";
            else if(path.equals("/list"))response="{\"resultCode\":\"0\",\"resultObject\":{\"data\":[{\"name\":\"/file.txt\",\"type\":\"file\",\"size\":14}]}}";
            else response=new String(file,StandardCharsets.UTF_8);
            var body=response.getBytes(StandardCharsets.UTF_8);exchange.sendResponseHeaders(200,body.length);exchange.getResponseBody().write(body);exchange.close();
        });server.start();
        try(var context=context(manager)) {
            var tenants=mock(com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper.class);
            when(tenants.selectConfig(123L,"NODE_SANDBOX_RECORD_ID")).thenReturn("31");when(tenants.selectConfig(123L,"DB_SANDBOX_RECORD_ID")).thenReturn("987");when(tenants.selectConfig(123L,"PROVISION_STATE")).thenReturn("{\"status\":\"READY\",\"generation\":1}");
            var membership=mock(com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper.class);
            var row=new com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipRow();row.setRole("MEMBER");when(membership.selectActiveMembership(30L,123L)).thenReturn(row);
            var sandbox=mock(com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper.class);var record=new com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord();record.setId(31L);record.setEnterpriseId(123L);record.setOwnerScope("TENANT");record.setStatus("RUNNING");when(sandbox.selectActiveTenantByResourceAndType(123L,"tenant-data-node")).thenReturn(record);
            var node=new com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient(tenants,sandbox,new ObjectMapper(),mock(com.iwhaleai.byai.framework.common.RedisClient.class),"fixture-only");
            var discovery=mock(com.iwhaleai.byai.framework.core.discovery.DiscoveryClient.class);ReflectionTestUtils.setField(node,"discovery",discovery);
            var endpoint=new com.iwhaleai.byai.framework.core.discovery.ServiceInstance();endpoint.setProtocol("http");endpoint.setHost("127.0.0.1");endpoint.setPort(server.getAddress().getPort());endpoint.setMetadata(Map.of("enterpriseId","123","generation","1","dbSandboxRecordId","987","mode","READY","agentType","TENANT_DATA_123"));
            when(discovery.getInstances("TENANT_DATA_123")).thenAnswer(inv->{boundaries.incrementAndGet();assertThat(active()).as("actual permission Node transport").isFalse();return List.of(endpoint);});
            context.registerBean("tenantProjectCloudAccessService",com.iwhalecloud.byai.manager.domain.tenant.TenantProjectCloudAccessService.class,()->new com.iwhalecloud.byai.manager.domain.tenant.TenantProjectCloudAccessService(new com.iwhalecloud.byai.manager.domain.tenant.TenantGroupData(node),tenants,membership));
            var project=new com.iwhalecloud.byai.manager.entity.devloop.Project();project.setProjectId(70L);project.setEnterpriseId(123L);project.setCreateBy(30L);
            var projects=mock(com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService.class);when(projects.findByCloudResourceId(60L)).thenReturn(List.of(project));
            context.registerBean("authApplicationService",com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService.class,()->{
                var auth=new com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService();ReflectionTestUtils.setField(auth,"projectService",projects);ReflectionTestUtils.setField(auth,"tenantProjectCloudAccessService",context.getBean(com.iwhalecloud.byai.manager.domain.tenant.TenantProjectCloudAccessService.class));return auth;
            });
            var resource=new com.iwhalecloud.byai.manager.entity.resource.SsResource();resource.setResourceId(60L);resource.setComAcctId(123L);resource.setResourceBizType("KG_CLOUD");resource.setResourceCode("cloud");
            var resources=mock(com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService.class);when(resources.findById(60L)).thenReturn(resource);
            var users=mock(com.iwhalecloud.byai.manager.domain.users.service.UserService.class);var user=new com.iwhalecloud.byai.manager.entity.users.Users();user.setUserCode("actor");when(users.findById(30L)).thenReturn(user);
            context.registerBean("feignPythonBuildService",com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService.class,()->{
                var transport=new com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService();
                var routes=mock(com.iwhalecloud.byai.common.feign.client.KnowledgeServiceEndpointResolver.class);var paths=mock(com.iwhalecloud.byai.common.feign.client.KnowledgeServicePathResolver.class);
                when(routes.resolveByKnCode("cloud")).thenAnswer(inv->{boundaries.incrementAndGet();assertThat(active()).as("actual QA metadata/download HTTP opening").isFalse();return com.iwhalecloud.byai.common.feign.client.KnowledgeServiceEndpoint.forDirectUrl("http://127.0.0.1:"+server.getAddress().getPort());});
                when(paths.resolveByKnCodeAndOperation(eq("cloud"),any())).thenAnswer(inv->inv.getArgument(1)==com.iwhalecloud.byai.common.feign.client.KnowledgeServiceOperation.LIST_DIR?"/list":"/download");
                var jwt=mock(com.iwhalecloud.byai.common.jwt.JwtService.class);when(jwt.createJwt(any(com.iwhalecloud.byai.common.login.bean.LoginInfo.class))).thenReturn("actor-token");
                ReflectionTestUtils.setField(transport,"knowledgeServiceEndpointResolver",routes);ReflectionTestUtils.setField(transport,"knowledgeServicePathResolver",paths);ReflectionTestUtils.setField(transport,"jwtService",jwt);return transport;
            });
            context.registerBean("datasetApplicationService",com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService.class,()->{
                var datasets=new com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService();ReflectionTestUtils.setField(datasets,"ssResourceService",resources);ReflectionTestUtils.setField(datasets,"authApplicationService",context.getBean(com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService.class));ReflectionTestUtils.setField(datasets,"forwardUserService",users);ReflectionTestUtils.setField(datasets,"feignPythonBuildService",context.getBean(com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService.class));return datasets;
            });
            context.registerBean("groupChatForwardAttachmentService",GroupChatForwardAttachmentService.class,()->new GroupChatForwardAttachmentService(new KnowledgeForwardSourceResolver(context.getBean(com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService.class)),null,null,new GroupChatForwardProperties(),ForwardAdmissionFixture.admission()));
            context.refresh();
            for(String name:List.of("datasetApplicationService","authApplicationService","tenantProjectCloudAccessService","feignPythonBuildService")) assertThat(AopUtils.isAopProxy(context.getBean(name))).as(name).isTrue();
            var actor=new ForwardActor(30,123);var source=new ResolvedSource(new SourceIdentity(123,null,"qa","60","/file.txt",null),"file.txt","text/plain",14L,"knowledge",null,null);
            new TransactionTemplate(manager).executeWithoutResult(status->{
                assertThat(active()).isTrue();assertThat(context.getBean(GroupChatForwardAttachmentService.class).freezeProof(actor,source).size()).isEqualTo(file.length);assertThat(active()).isTrue();
            });
            assertThat(boundaries.get()).isGreaterThanOrEqualTo(4);assertThat(requests.get()).isGreaterThanOrEqualTo(6);node.close();
        } finally {server.stop(0);}
    }

}
