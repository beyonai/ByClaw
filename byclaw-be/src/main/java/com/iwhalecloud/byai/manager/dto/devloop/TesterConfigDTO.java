package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/**
 * 独立测试数字员工配置入参/出参。嵌套结构对齐前端 TesterConfig(schedule/admission/kickback 三组),
 * 后端读写时与扁平实体列互转;projectId 必填,每项目唯一(upsert)。
 */
@Data
public class TesterConfigDTO {

    private Long projectId;

    /** 是否启用定时批量集成;关掉退回人工触发 */
    private Boolean enabled;

    private Schedule schedule;

    private Admission admission;

    private Kickback kickback;

    /** 定时节流:cron 决定多久看一次,到点只挑就绪需求批量测。 */
    @Data
    public static class Schedule {
        private String cron;
        private String cronLabel;
        private String timezone;
    }

    /** 就绪准入:到点后需求满足这些条件才纳入本轮批量集成。 */
    @Data
    public static class Admission {
        private Boolean requireAllCoded;
        private Integer maxConcurrentReqs;
    }

    /** 失败打回策略:集成失败后如何归因、回灌 dev-loop。 */
    @Data
    public static class Kickback {
        private Boolean autoAttribute;
        private Boolean createDefectWhenUnclear;
        private Integer maxRounds;
    }
}
