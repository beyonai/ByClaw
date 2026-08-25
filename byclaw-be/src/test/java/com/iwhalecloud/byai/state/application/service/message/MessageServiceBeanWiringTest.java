package com.iwhalecloud.byai.state.application.service.message;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.common.message.service.ByaiMessageRelObjService;
import com.iwhalecloud.byai.manager.mapper.showcase.ByaiShowcaseMapper;
import com.iwhalecloud.byai.state.application.service.session.SessionApplicationService;
import com.iwhalecloud.byai.state.application.service.taskplan.TaskPlanApplicationService;
import com.iwhalecloud.byai.state.domain.file.service.FileService;
import com.iwhalecloud.byai.state.domain.message.service.MemoryMessageService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceApplicationService;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.showcase.service.ShowcaseService;
import com.iwhalecloud.byai.state.domain.showcase.strategy.ShowcaseStrategyFactory;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.Test;
import org.springframework.aop.support.AopUtils;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;

class MessageServiceBeanWiringTest {

    @Test
    void createsMessageAndShowcaseServicesWithTransactionalProxy() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.getDefaultListableBeanFactory().setAllowCircularReferences(true);
            registerDependencies(context);
            context.register(TransactionConfiguration.class, MessageService.class, ShowcaseService.class);

            context.refresh();

            assertThat(AopUtils.isAopProxy(context.getBean(MessageService.class))).isTrue();
            assertThat(context.getBean(ShowcaseService.class)).isNotNull();
        }
    }

    private void registerDependencies(AnnotationConfigApplicationContext context) {
        registerMock(context, "memoryMessageService", MemoryMessageService.class);
        registerMock(context, "byaiSystemConfigService", ByaiSystemConfigService.class);
        registerMock(context, "sequenceService", SequenceService.class);
        registerMock(context, "sessionApplicationService", SessionApplicationService.class);
        registerMock(context, "byaiMessageHotService", ByaiMessageHotService.class);
        registerMock(context, "byaiMessageRelObjService", ByaiMessageRelObjService.class);
        registerMock(context, "sessionExtService", SessionExtService.class);
        registerMock(context, "sessionService", SessionService.class);
        registerMock(context, "taskPlanApplicationService", TaskPlanApplicationService.class);
        registerMock(context, "byaiShowcaseMapper", ByaiShowcaseMapper.class);
        registerMock(context, "showcaseStrategyFactory", ShowcaseStrategyFactory.class);
        registerMock(context, "fileService", FileService.class);
        registerMock(context, "resourceApplicationService", ResourceApplicationService.class);
    }

    private <T> void registerMock(AnnotationConfigApplicationContext context, String name, Class<T> type) {
        context.getBeanFactory().registerSingleton(name, mock(type));
    }

    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement
    static class TransactionConfiguration {

        @Bean
        PlatformTransactionManager transactionManager() {
            return mock(PlatformTransactionManager.class);
        }
    }
}
