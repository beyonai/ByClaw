package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model;

import com.fasterxml.jackson.annotation.JsonAnyGetter;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.Getter;
import lombok.Setter;

import java.util.HashMap;
import java.util.Map;

/**
 * Generic WeCom long-connection frame envelope, mirroring the reference SDK
 * {@code WsFrame} (src/types/api.ts). Both directions use
 * {@code { cmd, headers: { req_id }, body }}.
 *
 * <p>Two-stage parse contract (see plan §Task 2): the envelope is parsed first;
 * {@code body} is kept as a raw {@link JsonNode} and only bound to a concrete
 * DTO after dispatching on {@code cmd} then {@code body.msgtype} /
 * {@code body.event.eventtype}. ACK / heartbeat / subscribe-response frames have
 * NO {@code cmd} and NO {@code body} — only {@code headers.req_id} plus
 * {@code errcode} / {@code errmsg}, and are routed by {@code req_id} prefix or a
 * pending-ack lookup. Never try to bind {@code body} polymorphically in one pass.
 */
@Getter
@Setter
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public class WecomWsFrame {

    /** Command type; absent on ACK / heartbeat / subscribe-response frames. */
    private String cmd;

    /** Request headers; always carries {@code req_id}. */
    private Headers headers;

    /** Raw message body; null on ACK frames. Bind by cmd/msgtype/eventtype downstream. */
    private JsonNode body;

    /** Response error code, present on ACK / heartbeat / subscribe-response frames. */
    private Integer errcode;

    /** Response error message, present on ACK / heartbeat / subscribe-response frames. */
    private String errmsg;

    @Getter
    @Setter
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Headers {
        /** Wire field is snake_case {@code req_id}; be's ObjectMapper uses default camelCase. */
        @JsonProperty("req_id")
        private String reqId;

        /** Extra header fields kept verbatim for forward-compatibility. */
        private final Map<String, Object> extra = new HashMap<>();

        @JsonAnySetter
        public void putExtra(String key, Object value) {
            extra.put(key, value);
        }

        @JsonAnyGetter
        public Map<String, Object> getExtra() {
            return extra;
        }
    }

    /** Convenience: true when this frame is an ACK/heartbeat/subscribe response (no cmd). */
    public boolean isAck() {
        return cmd == null || cmd.isBlank();
    }

    /** Convenience: true when the ACK reports success (errcode 0). */
    public boolean isSuccess() {
        return errcode != null && errcode == 0;
    }

    public String reqId() {
        return headers == null ? null : headers.getReqId();
    }
}
