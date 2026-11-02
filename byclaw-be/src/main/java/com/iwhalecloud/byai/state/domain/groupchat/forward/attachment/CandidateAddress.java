package com.iwhalecloud.byai.state.domain.groupchat.forward.attachment;

/** A stable association selector, not an authorization or a physical file ID. */
public record CandidateAddress(String currentItemId, Origin origin, String key) {
    public enum Origin { RESOURCE_REFERENCE, RELATED_FILE, PUBLISHED_FILE }
}
