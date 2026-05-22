package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;

public record SandboxIngressUserContext(String beyondToken, LoginInfo loginInfo) {
}
