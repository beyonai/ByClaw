package com.iwhalecloud.byai.common.json;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;

/**
 * 兼容前端传 JSON 字符串或字符串数组，统一转成 JSON 字符串入库。
 */
public class StringOrArrayToJsonStringDeserializer extends JsonDeserializer<String> {

    @Override
    public String deserialize(JsonParser parser, DeserializationContext context) throws IOException {
        JsonToken token = parser.currentToken();
        if (token == JsonToken.VALUE_NULL) {
            return null;
        }
        if (token == JsonToken.VALUE_STRING) {
            return parser.getValueAsString();
        }
        if (token == JsonToken.START_ARRAY) {
            JsonNode node = parser.readValueAsTree();
            return getCodec(parser).writeValueAsString(node);
        }
        return context.readValue(parser, String.class);
    }

    private ObjectMapper getCodec(JsonParser parser) {
        return parser.getCodec() instanceof ObjectMapper objectMapper ? objectMapper : new ObjectMapper();
    }
}
