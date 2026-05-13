package com.iwhalecloud.byai.common.feign.response.knowledge;

import java.util.Map;

public class ModelDto {
    private String authToken;
    private String brandId;
    private Long createTime;
    private String createUser;
    private String instanceId;
    private String instanceMode;
    private String instanceName;
    private Map<String, Object> instanceParam;
    private String maxContentToken;
    private String modelCode;
    private String modelName;
    private Integer status;
    private String subInstance;
    private String url;
    private Integer userCount;
    private String username;
    private String modelType;
    private Integer isDefault;

    // Getters and Setters
    public String getAuthToken() {
        return authToken;
    }

    public void setAuthToken(String authToken) {
        this.authToken = authToken;
    }

    public String getBrandId() {
        return brandId;
    }

    public void setBrandId(String brandId) {
        this.brandId = brandId;
    }

    public Long getCreateTime() {
        return createTime;
    }

    public void setCreateTime(Long createTime) {
        this.createTime = createTime;
    }

    public String getCreateUser() {
        return createUser;
    }

    public void setCreateUser(String createUser) {
        this.createUser = createUser;
    }

    public String getInstanceId() {
        return instanceId;
    }

    public void setInstanceId(String instanceId) {
        this.instanceId = instanceId;
    }

    public String getInstanceMode() {
        return instanceMode;
    }

    public void setInstanceMode(String instanceMode) {
        this.instanceMode = instanceMode;
    }

    public String getInstanceName() {
        return instanceName;
    }

    public void setInstanceName(String instanceName) {
        this.instanceName = instanceName;
    }

    public Map<String, Object> getInstanceParam() {
        return instanceParam;
    }

    public void setInstanceParam(Map<String, Object> instanceParam) {
        this.instanceParam = instanceParam;
    }

    public String getMaxContentToken() {
        return maxContentToken;
    }

    public void setMaxContentToken(String maxContentToken) {
        this.maxContentToken = maxContentToken;
    }

    public String getModelCode() {
        return modelCode;
    }

    public void setModelCode(String modelCode) {
        this.modelCode = modelCode;
    }

    public String getModelName() {
        return modelName;
    }

    public void setModelName(String modelName) {
        this.modelName = modelName;
    }

    public Integer getStatus() {
        return status;
    }

    public void setStatus(Integer status) {
        this.status = status;
    }

    public String getSubInstance() {
        return subInstance;
    }

    public void setSubInstance(String subInstance) {
        this.subInstance = subInstance;
    }

    public String getUrl() {
        return url;
    }

    public void setUrl(String url) {
        this.url = url;
    }

    public Integer getUserCount() {
        return userCount;
    }

    public void setUserCount(Integer userCount) {
        this.userCount = userCount;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getModelType() {
        return modelType;
    }

    public void setModelType(String modelType) {
        this.modelType = modelType;
    }

    public Integer getIsDefault() {
        return isDefault;
    }

    public void setIsDefault(Integer isDefault) {
        this.isDefault = isDefault;
    }
}
