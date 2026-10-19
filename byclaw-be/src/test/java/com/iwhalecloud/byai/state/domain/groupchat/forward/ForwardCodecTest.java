package com.iwhalecloud.byai.state.domain.groupchat.forward;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.groupchat.forward.dto.ForwardDtos.OperationResponse;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardCodec;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import org.junit.jupiter.api.Test;
import java.nio.file.Path;
import java.util.List;
import static org.assertj.core.api.Assertions.*;

class ForwardCodecTest {
    final ForwardCodec codec = new ForwardCodec();
    final ObjectMapper mapper = new ObjectMapper();
    @Test void reorderedIdsHaveSameHash() throws Exception {
        var fixture = mapper.readTree(Path.of("../byclaw-qa/fixtures/group-chat-forward/v1.json").toFile());
        var actor = new ForwardActor(20, 10);
        var input = codec.readInput(fixture.get("input").toString());
        assertThat(codec.canonicalHash(actor, 30, input)).isEqualTo("a7ab474e44c2908860ccccffca2eedd5ca6b906ba632b35ef39138817416e8de");
        assertThat(codec.canonicalHash(actor, 30, new ForwardInput("other", ForwardMode.SINGLE, List.of(1001L, 1002L), List.of(2001L, 2002L)))).isEqualTo(fixture.get("canonicalHash").asText());
    }
    @Test void rejectsClientOverridesAndUnsafeIds() {
        for (String id : List.of("0", "-1", "01", "9223372036854775808")) {
            assertThatThrownBy(() -> codec.readInput("{\"clientRequestId\":\"ok\",\"mode\":\"SINGLE\",\"messageIds\":[\"" + id + "\"],\"targetSessionIds\":[\"2\"]}")).hasMessageContaining("FORWARD_INVALID_REQUEST");
        }
        assertThatThrownBy(() -> codec.readInput("{\"clientRequestId\":\"ok\",\"mode\":\"SINGLE\",\"messageIds\":[\"1\"],\"targetSessionIds\":[\"2\"],\"metadata\":{}}")).hasMessageContaining("FORWARD_INVALID_REQUEST");
    }
    @Test void serializesAggregateStatesIndependentlyOfBranchStates() throws Exception {
        var running = new ForwardOperation(501L, ForwardOperationState.RUNNING, List.of());
        var partial = new OperationResponse("501", ForwardOperationState.PARTIAL_FAILED, List.of());
        assertThat(mapper.readTree(mapper.writeValueAsString(running)).get("state").asText()).isEqualTo("RUNNING");
        assertThat(mapper.readTree(mapper.writeValueAsString(partial)).get("state").asText()).isEqualTo("PARTIAL_FAILED");
        assertThat(ForwardState.values()).extracting(Enum::name).containsExactly("PENDING", "COPYING", "READY", "SUCCEEDED", "FAILED");
    }

}
