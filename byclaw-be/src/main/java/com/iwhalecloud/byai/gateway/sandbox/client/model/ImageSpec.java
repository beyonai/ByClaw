package com.iwhalecloud.byai.gateway.sandbox.client.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ImageSpec {

    private String uri;

    private ImageAuth auth;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ImageAuth {
        private String username;
        private String password;
    }
}
