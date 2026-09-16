package com.iwhalecloud.byai.manager.infrastructure.sms;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.aliyun.dysmsapi20170525.Client;
import com.aliyun.dysmsapi20170525.models.SendSmsResponse;
import com.aliyun.dysmsapi20170525.models.SendSmsResponseBody;
import com.iwhalecloud.byai.manager.infrastructure.config.AliyunSmsConfig;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class AliyunSmsServiceTest {
    @Test
    void neverLogsPhoneCodeOrRequestForValidAndInvalidInput() throws Exception {
        AliyunSmsConfig config = new AliyunSmsConfig();
        config.setSignName("test-sign");
        AliyunSmsConfig.Templates templates = new AliyunSmsConfig.Templates();
        templates.setRegister("test-template");
        config.setTemplates(templates);
        AliyunSmsService service = spy(new AliyunSmsService());
        ReflectionTestUtils.setField(service, "smsConfig", config);
        Logger logger = (Logger) LoggerFactory.getLogger(AliyunSmsService.class);
        ListAppender<ILoggingEvent> logs = new ListAppender<>();
        logs.start();
        logger.addAppender(logs);
        Client client = mock(Client.class);
        doReturn(client).when(service).createClient();
        when(client.sendSms(any())).thenReturn(new SendSmsResponse()
            .setBody(new SendSmsResponseBody().setCode("OK")));
        try {
            assertThat(service.sendSms("13800000000", "654321", "register")).isTrue();
            assertThat(service.sendSms("13800000000-invalid", "654321-invalid", "register")).isFalse();
            assertThat(logs.list).allSatisfy(event -> assertThat(event.getFormattedMessage())
                .doesNotContain("13800000000", "654321", "phoneNumbers", "templateParam", "test-template"));
        } finally {
            logger.detachAppender(logs);
            logs.stop();
        }
    }
}
