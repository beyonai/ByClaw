package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.card;

import com.aliyun.dingtalkcard_1_0.Client;

/**
 * 钉钉卡片流式会话。
 * createAndDeliver 与后续 streamingUpdate 必须绑定同一个 outTrackId。
 */
public class DingtalkCardStreamSession {

    private final Client client;
    private final String accessToken;
    private final String outTrackId;
    private boolean finalized;

    public DingtalkCardStreamSession(Client client, String accessToken, String outTrackId) {
        this.client = client;
        this.accessToken = accessToken;
        this.outTrackId = outTrackId;
    }

    public Client getClient() {
        return client;
    }

    public String getAccessToken() {
        return accessToken;
    }

    public String getOutTrackId() {
        return outTrackId;
    }

    public boolean isFinalized() {
        return finalized;
    }

    public void setFinalized(boolean finalized) {
        this.finalized = finalized;
    }
}
