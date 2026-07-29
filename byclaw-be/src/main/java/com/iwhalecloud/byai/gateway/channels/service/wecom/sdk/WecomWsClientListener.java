package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk;

import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomWsFrame;

/**
 * Callbacks emitted by {@link WecomWsClient}. Mirrors the reference SDK's
 * WSClient event map (connected / authenticated / disconnected / reconnecting /
 * error / message) plus an explicit ACK-frame hook so Task 4's reply queue can
 * plug in without the client depending on it.
 *
 * <p>Business handling (message/event dispatch) is expected to happen off the
 * WebSocket read thread; implementors should hand work to a bounded executor.
 */
public interface WecomWsClientListener {

    /** WebSocket open (TCP connected, auth not yet confirmed). */
    default void onConnected() {
    }

    /** subscribe ACK returned errcode == 0; heartbeat has started. */
    default void onAuthenticated() {
    }

    /** Connection closed (any reason). */
    default void onDisconnected(String reason) {
    }

    /** Server took over this bot via a new connection (disconnected_event). No reconnect. */
    default void onServerTakeover(String reason) {
    }

    /** A reconnect attempt is scheduled (attempt counter for the relevant counter type). */
    default void onReconnecting(int attempt) {
    }

    /**
     * Ownership gate consulted right before a network-drop reconnect actually
     * reconnects. The registry validates/re-acquires the Redis single-active
     * lock here (CAS): if this instance no longer owns the bot's lock, return
     * false so the client stops instead of reconnecting and kicking whichever
     * instance took the bot over. Default true keeps the client standalone-usable
     * (e.g. unit tests) without a lock service.
     */
    default boolean canReconnect() {
        return true;
    }

    /** Transport or protocol error. */
    default void onError(Throwable error) {
    }

    /**
     * Terminal: reconnect/auth retries are exhausted and this client will not
     * reconnect on its own. The registry must stop the connection and release
     * its Redis lock so another instance can take the bot over.
     */
    default void onExhausted(String reason) {
    }

    /**
     * A command callback frame (aibot_msg_callback / aibot_event_callback).
     * disconnected_event is NOT delivered here as a normal callback — it is
     * surfaced via {@link #onServerTakeover(String)} after teardown.
     */
    void onCallback(WecomWsFrame frame);

    /**
     * An ACK / reply-receipt frame (no cmd, has req_id + errcode), routed here
     * after subscribe/heartbeat frames are handled internally. Task 4's reply
     * queue resolves pending sends from this hook.
     */
    default void onReplyAck(WecomWsFrame frame) {
    }
}
