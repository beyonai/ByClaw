package com.iwhalecloud.byai.state.domain.groupchat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMemberRequest;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class GroupChatMemberRequestTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void acceptsArraysAndLegacyScalarWithoutLosingLongPrecision() throws Exception {
        for (String id : new String[] {"[\"9007199254740993\",20]", "\"9007199254740993\"", "9007199254740993"}) {
            GroupChatMemberRequest request = mapper.readValue(
                "{\"type\":\"AGENT\",\"id\":" + id + "}", GroupChatMemberRequest.class);
            assertThat(request.getId().get(0)).isEqualTo(9007199254740993L);
        }
    }

    @Test
    void rejectsMissingEmptyNullAndNonPositiveIds() throws Exception {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            for (String id : new String[] {"null", "[]", "[null]", "[0]", "[-1]"}) {
                GroupChatMemberRequest request = mapper.readValue(
                    "{\"type\":\"USER\",\"id\":" + id + "}", GroupChatMemberRequest.class);
                assertThat(factory.getValidator().validate(request)).isNotEmpty();
            }
        }
    }
}
