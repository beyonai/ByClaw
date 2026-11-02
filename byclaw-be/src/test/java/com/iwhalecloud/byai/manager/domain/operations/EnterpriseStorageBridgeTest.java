package com.iwhalecloud.byai.manager.domain.operations;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/** 服务桥只转发明确企业和可信操作人，不扩展云盘写操作。 @author Codex @since 2026-11-02 */
class EnterpriseStorageBridgeTest {
    /** actor 来自桥信封，payload 中伪造的 actor 不覆盖它。 */
    @Test
    void dispatchesOnlyReadSummaryWithEnvelopeIdentity() {
        ObjectMapper objectMapper = new ObjectMapper();
        EnterpriseStorageService storage = mock(EnterpriseStorageService.class);
        PlatformOperationsService operations = new PlatformOperationsService();
        ReflectionTestUtils.setField(operations, "enterpriseStorageService", storage);
        ObjectNode result = objectMapper.createObjectNode().put("usedKb", "0");
        when(storage.summary(42, 7)).thenReturn(result);
        ObjectNode request = objectMapper.createObjectNode().put("resource", "enterprise-storage")
            .put("operation", "summary").put("actor", "7").put("requestId", "storage-1");
        request.putObject("payload").put("enterpriseId", "42").put("actor", "99");
        assertThat(operations.execute(request)).isSameAs(result);
        verify(storage).summary(42, 7);
        request.put("operation", "delete");
        assertThatThrownBy(() -> operations.execute(request)).isInstanceOf(OperationsFailure.class);
        verifyNoMoreInteractions(storage);
    }
}
