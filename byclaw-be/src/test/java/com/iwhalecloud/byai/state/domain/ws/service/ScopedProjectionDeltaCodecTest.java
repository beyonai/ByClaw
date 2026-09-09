package com.iwhalecloud.byai.state.domain.ws.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import org.junit.jupiter.api.Test;

class ScopedProjectionDeltaCodecTest {

    private final ScopedProjectionDeltaCodec codec = new ScopedProjectionDeltaCodec();

    @Test
    void encodesGrowingTextAndJsonArraysWithoutRepeatingTheWholeProjection() {
        JSONObject previous = projection("100-0", "重复", "[\"first\"]");
        JSONObject current = projection("101-0", "重复重复", "[\"first\",\"second\"]");

        JSONObject delta = codec.createDelta(previous, current, false);

        assertThat(delta.getString("type")).isEqualTo("SCOPED_MESSAGE_DELTA");
        assertThat(delta.getString("streamId")).isEqualTo("101-0");
        JSONObject payload = delta.getJSONObject("data");
        assertThat(payload.getString("baseStreamId")).isEqualTo("100-0");
        assertThat(payload.getString("messageId")).isEqualTo("answer-1");
        JSONArray operations = payload.getJSONArray("operations");
        assertThat(operations).anySatisfy(operation -> {
            JSONObject item = (JSONObject) operation;
            assertThat(item.getString("field")).isEqualTo("messageContent");
            assertThat(item.getString("op")).isEqualTo("append");
            assertThat(item.getInteger("offset")).isEqualTo(2);
            assertThat(item.getString("value")).isEqualTo("重复");
        });
        assertThat(operations).anySatisfy(operation -> {
            JSONObject item = (JSONObject) operation;
            assertThat(item.getString("field")).isEqualTo("inferLog");
            assertThat(item.getString("op")).isEqualTo("json-array-splice");
            assertThat(item.getInteger("index")).isEqualTo(1);
            assertThat(item.getInteger("deleteCount")).isZero();
            assertThat(item.getJSONArray("value")).containsExactly("second");
        });
        assertThat(delta.toJSONString().length()).isLessThan(current.toJSONString().length());
    }

    @Test
    void replacesOnlyTheChangedArraySuffixAndKeepsIdenticalTextAtANewOffset() {
        JSONObject previous = projection("100-0", "ha", "[{\"id\":1,\"text\":\"old\"},{\"id\":2}]");
        JSONObject current = projection("101-0", "haha", "[{\"id\":1,\"text\":\"new\"},{\"id\":2},{\"id\":3}]");

        JSONObject delta = codec.createDelta(previous, current, false);

        JSONArray operations = delta.getJSONObject("data").getJSONArray("operations");
        assertThat(operations).anySatisfy(operation -> {
            JSONObject item = (JSONObject) operation;
            if (!"messageContent".equals(item.getString("field"))) return;
            assertThat(item.getString("op")).isEqualTo("append");
            assertThat(item.getInteger("offset")).isEqualTo(2);
            assertThat(item.getString("value")).isEqualTo("ha");
        });
        assertThat(operations).anySatisfy(operation -> {
            JSONObject item = (JSONObject) operation;
            if (!"inferLog".equals(item.getString("field"))) return;
            assertThat(item.getString("op")).isEqualTo("json-array-splice");
            assertThat(item.getInteger("index")).isZero();
            assertThat(item.getInteger("deleteCount")).isEqualTo(2);
            assertThat(item.getJSONArray("value")).hasSize(3);
        });
    }

    @Test
    void patchesGrowingTextInsideTheLastJsonArrayItem() {
        String stable = "x".repeat(8_000);
        JSONObject previousItem = JSON.parseObject("{\"id\":1,\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}");
        previousItem.put("stable", stable);
        JSONObject currentItem = JSON.parseObject(previousItem.toJSONString());
        currentItem.getJSONArray("choices").getJSONObject(0).getJSONObject("delta").put("content", "hello world");
        JSONObject previous = projection("100-0", "", new JSONArray().fluentAdd(previousItem).toJSONString());
        JSONObject current = projection("101-0", "", new JSONArray().fluentAdd(currentItem).toJSONString());

        JSONObject delta = codec.createDelta(previous, current, false);

        JSONObject operation = delta.getJSONObject("data").getJSONArray("operations").getJSONObject(0);
        assertThat(operation.getString("field")).isEqualTo("inferLog");
        assertThat(operation.getString("op")).isEqualTo("json-patch");
        JSONObject patch = operation.getJSONArray("patches").getJSONObject(0);
        assertThat(patch.getString("op")).isEqualTo("append");
        assertThat(patch.getJSONArray("path")).containsExactly(0, "choices", 0, "delta", "content");
        assertThat(patch.getInteger("offset")).isEqualTo(5);
        assertThat(patch.getString("value")).isEqualTo(" world");
        assertThat(delta.toJSONString().length()).isLessThan(1_000);
    }

    @Test
    void patchesGrowingTextInsideAJsonObjectField() {
        JSONObject previous = projection("100-0", "", "[]");
        JSONObject current = projection("101-0", "", "[]");
        previous.getJSONObject("data").put("lastEvent", "{\"content\":\"a\",\"stable\":\"" + "x".repeat(4_000) + "\"}");
        current.getJSONObject("data").put("lastEvent", "{\"content\":\"ab\",\"stable\":\"" + "x".repeat(4_000) + "\"}");

        JSONObject delta = codec.createDelta(previous, current, false);

        JSONObject operation = delta.getJSONObject("data").getJSONArray("operations").stream()
            .map(JSONObject.class::cast)
            .filter(item -> "lastEvent".equals(item.getString("field")))
            .findFirst()
            .orElseThrow();
        assertThat(operation.getString("op")).isEqualTo("json-patch");
        assertThat(operation.getJSONArray("patches").getJSONObject(0).getJSONArray("path"))
            .containsExactly("content");
        assertThat(delta.toJSONString().length()).isLessThan(1_000);
    }

    private JSONObject projection(String streamId, String content, String inferLog) {
        JSONObject data = new JSONObject();
        data.put("sessionId", 200L);
        data.put("messageId", "answer-1");
        data.put("messageContent", content);
        data.put("inferLog", inferLog);
        data.put("metadata", "{\"worker\":\"BYCLAW_DSH\"}");
        data.put("stablePayload", "x".repeat(1000));
        JSONObject envelope = new JSONObject();
        envelope.put("type", "NEW_MESSAGE");
        envelope.put("sessionId", "200");
        envelope.put("streamId", streamId);
        envelope.put("data", data);
        return envelope;
    }
}
