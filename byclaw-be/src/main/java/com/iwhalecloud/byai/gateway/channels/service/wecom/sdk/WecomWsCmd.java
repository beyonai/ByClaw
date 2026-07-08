package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk;

/**
 * WeCom long-connection command constants (reference SDK {@code WsCmd}, src/types/api.ts).
 */
public final class WecomWsCmd {

    // dev -> WeCom
    public static final String SUBSCRIBE = "aibot_subscribe";
    public static final String HEARTBEAT = "ping";
    public static final String RESPONSE = "aibot_respond_msg";
    public static final String RESPONSE_WELCOME = "aibot_respond_welcome_msg";
    public static final String RESPONSE_UPDATE = "aibot_respond_update_msg";
    public static final String SEND_MSG = "aibot_send_msg";
    public static final String UPLOAD_MEDIA_INIT = "aibot_upload_media_init";
    public static final String UPLOAD_MEDIA_CHUNK = "aibot_upload_media_chunk";
    public static final String UPLOAD_MEDIA_FINISH = "aibot_upload_media_finish";

    // WeCom -> dev
    public static final String CALLBACK = "aibot_msg_callback";
    public static final String EVENT_CALLBACK = "aibot_event_callback";

    public static final String DISCONNECTED_EVENT = "disconnected_event";

    private WecomWsCmd() {
    }
}
