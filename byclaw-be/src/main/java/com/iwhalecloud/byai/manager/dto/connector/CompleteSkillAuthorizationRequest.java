package com.iwhalecloud.byai.manager.dto.connector;

import lombok.Getter;
import lombok.Setter;

/** Skill authorization completion request. Identity and credential details are server-resolved. */
@Getter
@Setter
public class CompleteSkillAuthorizationRequest {

    private String connectorCode;
}
