package com.iwhalecloud.byai.manager.domain.resource.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.infrastructure.kafka.ZlogAdapter;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDigEmployeeMapper;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.clients.producer.RecordMetadata;
import org.apache.kafka.common.TopicPartition;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.mockito.MockedStatic;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.kafka.support.SendResult;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;

class ResourceEventServiceTest {
    MockedStatic<I18nUtil> messages;

    @BeforeEach void setupMessages() {
        messages = mockStatic(I18nUtil.class);
        messages.when(() -> I18nUtil.get(anyString())).thenAnswer(call -> call.getArgument(0));
    }

    @AfterEach void closeMessages() { messages.close(); }

    final ZlogAdapter adapter = mock(ZlogAdapter.class);
    final SsResExtDigEmployeeMapper mapper = mock(SsResExtDigEmployeeMapper.class);
    final ObjectMapper json = new ObjectMapper();
    final SsResource resource = new SsResource();

    ResourceEventServiceTest() {
        resource.setResourceId(123L);
        resource.setResourceName("资源事件回归");
        resource.setComAcctId(1L);
    }

    ResourceEventService service(boolean enabled) {
        var service = new ResourceEventService();
        ReflectionTestUtils.setField(service, "kafkaEnabled", enabled);
        ReflectionTestUtils.setField(service, "zlogAdapter", adapter);
        ReflectionTestUtils.setField(service, "objectMapper", json);
        ReflectionTestUtils.setField(service, "ssResExtDigEmployeeMapper", mapper);
        return service;
    }

    void send(ResourceEventService service, String event) {
        switch (event) {
            case "resourceShelf" -> service.sendResourceShelfEvent(resource);
            case "resourceUnshelf" -> service.sendResourceUnshelfEvent(resource);
            case "resourceAuditPass" -> service.sendResourceAuditPassEvent(resource);
            case "resourceAuditReject" -> service.sendResourceAuditRejectEvent(resource);
            default -> throw new IllegalArgumentException(event);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"resourceShelf", "resourceUnshelf", "resourceAuditPass", "resourceAuditReject"})
    void disabledEventsDoNotQueryOrSend(String event) {
        send(service(false), event);
        verifyNoInteractions(adapter, mapper);
    }

    @ParameterizedTest
    @ValueSource(strings = {"resourceShelf", "resourceUnshelf", "resourceAuditPass", "resourceAuditReject"})
    void enabledEventsRetainTopicAndPayload(String event) throws Exception {
        var metadata = new RecordMetadata(new TopicPartition("resource-events", 0), 10L, 0, 0L, 0, 0);
        when(adapter.send(anyString(), anyString())).thenReturn(CompletableFuture.completedFuture(
            new SendResult<>(new ProducerRecord<>("resource-events", "test"), metadata)));
        send(service(true), event);
        var body = ArgumentCaptor.forClass(String.class);
        verify(adapter).send(eq("resource-events"), body.capture());
        var message = json.readTree(body.getValue());
        assertThat(message.at("/metadata/eventType").asText()).isEqualTo(event);
        assertThat(message.at("/metadata/eventId").asText()).isNotBlank();
        assertThat(message.at("/payload/resource/resourceId").asLong()).isEqualTo(123L);
        assertThat(message.at("/payload/resource/enterpriseId").asLong()).isEqualTo(1L);
    }

    @ParameterizedTest
    @ValueSource(strings = {"resourceShelf", "resourceUnshelf", "resourceAuditPass", "resourceAuditReject"})
    void enabledFailedDeliveryIsNotReportedAsSuccess(String event) {
        when(adapter.send(anyString(), anyString())).thenReturn(
            CompletableFuture.failedFuture(new IllegalStateException("broker unavailable")));
        assertThatThrownBy(() -> send(service(true), event)).isInstanceOf(BaseException.class)
            .hasRootCauseMessage("broker unavailable");
    }

    @ParameterizedTest
    @ValueSource(strings = {"resourceShelf", "resourceUnshelf", "resourceAuditPass", "resourceAuditReject"})
    void enabledMissingAdapterRemainsAnError(String event) {
        var service = service(true);
        ReflectionTestUtils.setField(service, "zlogAdapter", null);
        assertThatThrownBy(() -> send(service, event)).isInstanceOf(BaseException.class);
    }

    @Test
    void missingAndDisabledConfigurationAllowBusinessTransactionToCommit() {
        for (String[] properties : new String[][] { {}, {"zlog.adapter.kafka.enabled=false"} }) {
            new ApplicationContextRunner().withPropertyValues(properties)
                .withBean(ObjectMapper.class, () -> json)
                .withBean(SsResExtDigEmployeeMapper.class, () -> mapper)
                .withBean(ResourceEventService.class).run(context -> {
                    assertThat(context).hasNotFailed();
                    var db = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1");
                    var jdbc = new JdbcTemplate(db);
                    jdbc.execute("create table resource_creation (id bigint primary key)");
                    new TransactionTemplate(new DataSourceTransactionManager(db)).executeWithoutResult(status -> {
                        jdbc.update("insert into resource_creation values (?)", 123L);
                        send(context.getBean(ResourceEventService.class), "resourceShelf");
                    });
                    assertThat(jdbc.queryForObject("select count(*) from resource_creation", Integer.class)).isEqualTo(1);
                    verifyNoInteractions(mapper);
                });
        }
    }

    @Test
    void enabledConfigurationStillRollsBackWhenAdapterIsUnavailable() {
        new ApplicationContextRunner().withPropertyValues("zlog.adapter.kafka.enabled=true")
            .withBean(ObjectMapper.class, () -> json)
            .withBean(SsResExtDigEmployeeMapper.class, () -> mapper)
            .withBean(ResourceEventService.class).run(context -> {
                var db = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1");
                var jdbc = new JdbcTemplate(db);
                jdbc.execute("create table resource_creation (id bigint primary key)");
                var transaction = new TransactionTemplate(new DataSourceTransactionManager(db));
                assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
                    jdbc.update("insert into resource_creation values (?)", 123L);
                    send(context.getBean(ResourceEventService.class), "resourceShelf");
                })).isInstanceOf(BaseException.class);
                assertThat(jdbc.queryForObject("select count(*) from resource_creation", Integer.class)).isZero();
            });
    }
}
