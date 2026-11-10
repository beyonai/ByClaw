package com.iwhalecloud.byai.state.application.service.filebrowser;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.platform.*;
import com.iwhalecloud.byai.state.common.exception.StorageWriteConflictException;
import feign.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.env.MockEnvironment;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class FileWriteConflictMappingTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {
    @Test void onlyExplicitWriteConflictCodesHaveTheChineseRetryMessage() {
        PlatformRemoteGateway gateway=new PlatformRemoteGateway(mock(PlatformBackgroundExecution.class),mock(ObjectProvider.class),new ObjectMapper(),new MockEnvironment().withProperty("byclaw.platform.base-url","http://127.0.0.1:1"));
        for(String code:List.of("file_write_in_progress","file_write_conflict")) {
            int status=code.endsWith("progress")?423:409;
            StorageWriteConflictException error=assertThrows(StorageWriteConflictException.class,()->gateway.safe(()->{throw failure(status,code);}));
            assertEquals("文件写入中，请稍后再试",error.getReason());
        }
        for(String code:List.of("storage_node_unavailable","target_exists","quota_exceeded","permission_denied")) {
            RuntimeException error=assertThrows(RuntimeException.class,()->gateway.safe(()->{throw failure(503,code);}));
            assertFalse(error instanceof StorageWriteConflictException);
        }
    }
    @Test void nonConflictAndMismatchedStatusCodesKeepOriginalRemoteFailure() {
        PlatformRemoteGateway gateway=new PlatformRemoteGateway(mock(PlatformBackgroundExecution.class),mock(ObjectProvider.class),new ObjectMapper(),new MockEnvironment().withProperty("byclaw.platform.base-url","http://127.0.0.1:1"));
        for(int status:List.of(409,423)) {
            for(String code:List.of("target_exists","permission_denied","storage_node_unavailable")) {
                assertThrows(com.iwhalecloud.byai.state.common.exception.BdpRuntimeException.class,
                    ()->gateway.safe(()->{throw failure(status,code);}));
            }
            String mismatched=status==409?"file_write_in_progress":"file_write_conflict";
            assertThrows(com.iwhalecloud.byai.state.common.exception.BdpRuntimeException.class,
                ()->gateway.safe(()->{throw failure(status,mismatched);}));
            for(String body:List.of("", "not-json", "null", "[]")) {
                assertThrows(com.iwhalecloud.byai.state.common.exception.BdpRuntimeException.class,
                    ()->gateway.safe(()->{throw failureBody(status,body);}));
            }
        }
    }

    private FeignException failure(int status,String code) {
        return failureBody(status,"{\"code\":-1,\"data\":{\"errorType\":\""+code+"\"}}");
    }
    private FeignException failureBody(int status,String body) {
        Request request=Request.create(Request.HttpMethod.POST,"http://localhost/upload",Map.of(),new byte[0],StandardCharsets.UTF_8,null);
        return FeignException.errorStatus("upload",Response.builder().status(status).reason("fixture").request(request).headers(Map.of()).body(body,StandardCharsets.UTF_8).build());
    }
}
