package com.iwhalecloud.byai.common.log.exception;


import static com.iwhalecloud.byai.common.log.exception.ServiceCode.INTELLIGENT_AGENT_PLATFORM_ERROR;

public class KnowledgeRuntimeExcepion extends BaseRuntimeException{
    public KnowledgeRuntimeExcepion(String errorMsg) {
        super(errorMsg);
    }

    public KnowledgeRuntimeExcepion(Throwable cause ) {
        super(INTELLIGENT_AGENT_PLATFORM_ERROR, cause);
    }
}
