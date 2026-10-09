package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import java.util.List;
import org.apache.commons.lang3.StringUtils;

/**
 * 员工发布专用 A/B 接口，由 EmployeePublicationSkillService 实现；不调用原有独立技能上架方法。
 * 未提供实现时，个人技能在确认清单中标为不带入，员工本身仍可发布。
 */
public interface EmployeePublicationSkillBridge {
    record Context(Long tenantId, Long authorId, Long requestId, String copyName) {
        public Context(Long tenantId, Long authorId, Long requestId) {
            this(tenantId, authorId, requestId, null);
        }
    }

    /** 与用户约定的技能根目录/references/resourceMate.json 中的一项依赖。 */
    record Issue(String resourceId, String resourceType, String name, String reason) {
        static final String PERSONAL_RESOURCE_REASON = "依赖个人资源，不随员工发布";

        /** 明确提示被排除的是技能，并指出它声明依赖的个人资源类型与名称。 */
        String displayReason() {
            String resourceName = StringUtils.defaultIfBlank(name, StringUtils.defaultIfBlank(resourceId, "未命名资源"));
            if (PERSONAL_RESOURCE_REASON.equals(reason)) {
                String type = switch (StringUtils.defaultString(resourceType)) {
                    case "KNOWLEDGE_BASE" -> "知识库";
                    case "TOOL" -> "工具";
                    default -> "资源";
                };
                return "技能依赖了个人" + type + "「" + resourceName + "」，因此本次不会随员工发布";
            }
            return resourceName + "：" + reason;
        }
    }

    record CheckResult(boolean copyAllowed, List<Issue> issues) { }

    /** A：只读检查给定包；返回不通过仅排除此技能，不阻断员工发布。 */
    CheckResult check(SsResource source, SsResExtSkill snapshot, byte[] packageBytes, Context context);

    /**
     * B：只在员工审核通过/管理员免审执行阶段调用。
     * 上传给定快照到企业 Hub，创建企业技能及员工关系，返回企业技能 ID。
     * 与调用方使用同一数据库事务；同一 requestId/sourceId/hash 重试必须幂等。
     * 不新建独立审核申请，不返回个人技能 ID，不修改个人技能。
     * 发生写入故障应抛异常，由发布事务回滚，不能留下半份可用副本。
     */
    Long publish(SsResource source, SsResExtSkill snapshot, byte[] packageBytes,
        Long officialEmployeeId, Context context);
}
