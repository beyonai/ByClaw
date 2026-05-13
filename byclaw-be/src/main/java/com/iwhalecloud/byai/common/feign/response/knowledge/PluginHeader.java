package com.iwhalecloud.byai.common.feign.response.knowledge;

/**
     * 插件请求头信息
     */
    public  class PluginHeader {
        /**
         * 请求头类型
         */
        private Integer type;
        
        /**
         * 请求头编码
         */
        private String headerCode;
        
        /**
         * 请求头值
         */
        private String headerValue;
        
        /**
         * 请求头描述
         */
        private String headerDescription;
        
        /**
         * 方法类型（仅当type=1时存在）
         */
        private Integer methodType;
        
        // Getters and Setters
        public Integer getType() {
            return type;
        }
        
        public void setType(Integer type) {
            this.type = type;
        }
        
        public String getHeaderCode() {
            return headerCode;
        }
        
        public void setHeaderCode(String headerCode) {
            this.headerCode = headerCode;
        }
        
        public String getHeaderValue() {
            return headerValue;
        }
        
        public void setHeaderValue(String headerValue) {
            this.headerValue = headerValue;
        }
        
        public String getHeaderDescription() {
            return headerDescription;
        }
        
        public void setHeaderDescription(String headerDescription) {
            this.headerDescription = headerDescription;
        }
        
        public Integer getMethodType() {
            return methodType;
        }
        
        public void setMethodType(Integer methodType) {
            this.methodType = methodType;
        }
    }
    