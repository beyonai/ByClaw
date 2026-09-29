package com.iwhalecloud.byai.state.domain.linkpreview.dto;

/** Public page metadata only; HTML and remote response headers never leave the fetcher. */
public record LinkPreviewResponse(boolean resolved, String title, String description,
    String favicon, String ogImage, String siteName) {
    public static LinkPreviewResponse unavailable() {
        return new LinkPreviewResponse(false, "", "", "", "", "");
    }
}
