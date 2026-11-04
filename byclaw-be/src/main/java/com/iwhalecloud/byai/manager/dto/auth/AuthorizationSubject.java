package com.iwhalecloud.byai.manager.dto.auth;

import lombok.Data;

/** User membership used by the bounded authorization snapshot queries. */
@Data
public class AuthorizationSubject {
    private Long userId;
    private String subjectType;
    private Long subjectId;
    private String subjectPath;
}
