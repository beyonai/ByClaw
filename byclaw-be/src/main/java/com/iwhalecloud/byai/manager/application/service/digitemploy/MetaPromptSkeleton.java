package com.iwhalecloud.byai.manager.application.service.digitemploy;

class MetaPromptSkeleton {

    private final String agentTypeCode;
    private final String skeletonType;
    private final String zhName;
    private final String enName;
    private final String zhSkeleton;
    private final String enSkeleton;
    private final String zhDefaultWorkStandard;
    private final String enDefaultWorkStandard;

    MetaPromptSkeleton(String agentTypeCode, String skeletonType, String zhName, String enName, String zhSkeleton,
        String enSkeleton, String zhDefaultWorkStandard, String enDefaultWorkStandard) {
        this.agentTypeCode = agentTypeCode;
        this.skeletonType = skeletonType;
        this.zhName = zhName;
        this.enName = enName;
        this.zhSkeleton = zhSkeleton;
        this.enSkeleton = enSkeleton;
        this.zhDefaultWorkStandard = zhDefaultWorkStandard;
        this.enDefaultWorkStandard = enDefaultWorkStandard;
    }

    String getAgentTypeCode() {
        return agentTypeCode;
    }

    String getSkeletonType() {
        return skeletonType;
    }

    String getDisplayName(boolean isChinese) {
        return isChinese ? zhName : enName;
    }

    String getSkeleton(boolean isChinese) {
        return isChinese ? zhSkeleton : enSkeleton;
    }

    String getDefaultWorkStandard(boolean isChinese) {
        return isChinese ? zhDefaultWorkStandard : enDefaultWorkStandard;
    }
}
