package com.iwhalecloud.byai.manager.dto.devloop;

import com.alibaba.fastjson.annotation.JSONField;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 面向数字员工的只读项目上下文。
 */
@Getter
@Setter
public class ProjectContextDto {

    private Long projectId;
    private Long sessionId;
    private String resolvedBy;
    private ProjectSummary project;
    private List<RepositorySummary> repositories = new ArrayList<>();
    private List<ResourceSummary> knowledgeBases = new ArrayList<>();
    private OntologySummary ontologies = new OntologySummary();
    private List<ResourceSummary> digitalEmployees = new ArrayList<>();
    private List<ResourceSummary> otherResources = new ArrayList<>();
    private List<MemberSummary> members = new ArrayList<>();
    private List<SharedFileSummary> sharedFiles = new ArrayList<>();
    private Map<String, Long> counts = new LinkedHashMap<>();
    private Map<String, Boolean> truncated = new LinkedHashMap<>();

    @Getter
    @Setter
    public static class ProjectSummary {
        private Long projectId;
        private String projectName;
        private String description;
        private String projectType;
        private String isShare;
        private String initStatus;
        private String buildIndex;
        private String indexSkills;
        private Long createBy;

        @JSONField(format = "yyyy-MM-dd HH:mm:ss")
        private Date createTime;
    }

    @Getter
    @Setter
    public static class RepositorySummary {
        private Long repoId;
        private String repoFullName;
        private String repoUrl;
        private String defaultBranch;
        private String description;
        private String repoType;
        private String provider;
    }

    @Getter
    @Setter
    public static class ResourceSummary {
        private String bindingType;
        private String resourceId;
        private String resourceName;
        private String resourceBizType;
        private String resourceCode;
        private String description;
        private Long parentResourceId;
        private boolean available;
    }

    @Getter
    @Setter
    public static class OntologySummary {
        private List<ResourceSummary> bases = new ArrayList<>();
        private List<ResourceSummary> objects = new ArrayList<>();
        private List<ResourceSummary> views = new ArrayList<>();
        private List<ResourceSummary> scenes = new ArrayList<>();
        private List<ResourceSummary> others = new ArrayList<>();
    }

    @Getter
    @Setter
    public static class MemberSummary {
        private Long userId;
        private String userName;
        private String userNumber;
        private String role;
        private Long agentId;
        private String agentName;
    }

    @Getter
    @Setter
    public static class SharedFileSummary {
        private Long fileId;
        private String fileName;
        private String fileType;
        private Long length;
        private String contentType;
        private Long createBy;
        private Long chatId;
        private String shareLink;

        @JSONField(format = "yyyy-MM-dd HH:mm:ss")
        private Date createTime;
    }
}
