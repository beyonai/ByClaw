package com.iwhalecloud.byai.state.domain.agent.model;

import java.util.List;

public class SearchTypeCheckResult {
    List<String> validSearchTypes;

    List<String> validSessionSearchTypes;

    public List<String> getValidSearchTypes() {
        return validSearchTypes;
    }

    public void setValidSearchTypes(List<String> validSearchTypes) {
        this.validSearchTypes = validSearchTypes;
    }

    public List<String> getValidSessionSearchTypes() {
        return validSessionSearchTypes;
    }

    public void setValidSessionSearchTypes(List<String> validSessionSearchTypes) {
        this.validSessionSearchTypes = validSessionSearchTypes;
    }
}