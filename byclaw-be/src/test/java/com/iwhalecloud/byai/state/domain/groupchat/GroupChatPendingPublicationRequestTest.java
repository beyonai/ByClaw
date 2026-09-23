package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Collections;
import java.util.List;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatPendingPublicationRequest;

/** 请求边界覆盖可选版本、字符串大 ID 及原有内容长度约束。 */
class GroupChatPendingPublicationRequestTest {
    @Test
    void acceptsLegacyRequestAndDecimalStringVersionWithoutPrecisionLoss() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        var legacy = mapper.readValue("{\"text\":\"legacy\"}", GroupChatPendingPublicationRequest.class);
        var edit = mapper.readValue(
            "{\"expectedPendingPublicationId\":\"9007199254740993\",\"text\":\"edited\"}",
            GroupChatPendingPublicationRequest.class);
        assertThat(legacy.getExpectedPendingPublicationId()).isNull();
        assertThat(edit.getExpectedPendingPublicationId()).isEqualTo(9007199254740993L);
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            assertThat(factory.getValidator().validate(legacy)).isEmpty();
            assertThat(factory.getValidator().validate(edit)).isEmpty();
            edit.setExpectedPendingPublicationId(0L);
            assertThat(factory.getValidator().validate(edit)).hasSize(1);
            edit.setExpectedPendingPublicationId(-1L);
            assertThat(factory.getValidator().validate(edit)).hasSize(1);
        }
    }

    @Test
    void enforcesTextAttachmentAndPathLimitsAtRequestBoundary() {
        var request = new GroupChatPendingPublicationRequest();
        request.setText("a".repeat(100000));
        request.setSourcePaths(Collections.nCopies(100, "/by/" + "a".repeat(4092)));
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            assertThat(validator.validate(request)).isEmpty();
            request.setText("a".repeat(100001));
            assertThat(validator.validate(request)).hasSize(1);
            request.setText(null);
            request.setSourcePaths(Collections.nCopies(101, "/by/a"));
            assertThat(validator.validate(request)).hasSize(1);
            request.setSourcePaths(List.of("/by/" + "a".repeat(4093)));
            assertThat(validator.validate(request)).hasSize(1);
            request.setSourcePaths(List.of(" "));
            assertThat(validator.validate(request)).hasSize(1);
        }
    }
}
