package com.iwhalecloud.byai.manager.application.service.devloop;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.constants.devloop.DeleteFlag;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectSessionService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectContextDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectContextQueryDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectContextSharedFileDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberListDto;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectResourceMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectShareFileMapper;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 聚合当前用户可见的项目上下文，供 OpenClaw 底层只读 skill 使用。
 */
@Service
public class ProjectContextApplicationService {

    private static final int DEFAULT_FILE_LIMIT = 50;
    private static final int MAX_FILE_LIMIT = 100;
    private static final Set<String> ALL_SECTIONS = Set.of(
        "basic", "repositories", "knowledge", "ontologies", "members", "sharedfiles");
    private static final Set<String> KNOWLEDGE_TYPES = Set.of("KG_DOC", "KG_DB", "KG_QA", "KG_TERM");

    @Autowired
    private ProjectService projectService;

    @Autowired
    private ProjectSessionService projectSessionService;

    @Autowired
    private ProjectMemberService projectMemberService;

    @Autowired
    private ProjectRepoMapper projectRepoMapper;

    @Autowired
    private ProjectResourceMapper projectResourceMapper;

    @Autowired
    private ProjectShareFileMapper projectShareFileMapper;

    @Autowired
    private SsResourceService ssResourceService;

    /**
     * 查询项目上下文。projectId 优先，sessionId 仅作为降级解析来源。
     */
    public ProjectContextDto getProjectContext(ProjectContextQueryDto query) {
        if (query == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.context.query.required");
        }
        Resolution resolution = resolveProject(query);
        Project project = requireVisibleProject(resolution.projectId());
        Set<String> sections = normalizeSections(query.getSections());

        ProjectContextDto result = new ProjectContextDto();
        result.setProjectId(project.getProjectId());
        result.setSessionId(query.getSessionId());
        result.setResolvedBy(resolution.resolvedBy());

        if (sections.contains("basic")) {
            result.setProject(toProjectSummary(project));
        }
        if (sections.contains("repositories")) {
            List<ProjectContextDto.RepositorySummary> repositories = loadRepositories(project.getProjectId());
            result.setRepositories(repositories);
            result.getCounts().put("repositories", (long) repositories.size());
        }
        if (sections.contains("knowledge") || sections.contains("ontologies")) {
            loadResources(project.getProjectId(), sections, result);
        }
        if (sections.contains("members")) {
            List<ProjectContextDto.MemberSummary> members = loadMembers(project.getProjectId());
            result.setMembers(members);
            result.getCounts().put("members", (long) members.size());
        }
        if (sections.contains("sharedfiles")) {
            loadSharedFiles(project.getProjectId(), normalizeFileLimit(query.getPageSize()), result);
        }
        return result;
    }

    private Resolution resolveProject(ProjectContextQueryDto query) {
        if (query.getProjectId() != null) {
            return new Resolution(query.getProjectId(), "projectId");
        }
        if (query.getSessionId() == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.context.identifier.required");
        }
        Long projectId = projectSessionService.findProjectIdBySessionId(query.getSessionId());
        if (projectId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.context.session.unbound");
        }
        return new Resolution(projectId, "sessionId");
    }

    private Project requireVisibleProject(Long projectId) {
        Project project = projectService.findById(projectId);
        if (project == null || DeleteFlag.DELETED.equals(project.getDeleteFlag())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.not.found");
        }
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        boolean visible = "default".equalsIgnoreCase(project.getProjectType())
            || Objects.equals(project.getCreateBy(), currentUserId)
            || projectMemberService.isMember(projectId, currentUserId);
        if (!visible) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.context.access.denied");
        }
        return project;
    }

    private Set<String> normalizeSections(Collection<String> rawSections) {
        if (rawSections == null || rawSections.isEmpty()) {
            return ALL_SECTIONS;
        }
        Set<String> sections = rawSections.stream()
            .filter(Objects::nonNull)
            .map(value -> value.replace("_", "").replace("-", "").toLowerCase(Locale.ROOT))
            .filter(ALL_SECTIONS::contains)
            .collect(Collectors.toCollection(LinkedHashSet::new));
        return sections.isEmpty() ? ALL_SECTIONS : sections;
    }

    private int normalizeFileLimit(Integer pageSize) {
        if (pageSize == null || pageSize <= 0) {
            return DEFAULT_FILE_LIMIT;
        }
        return Math.min(pageSize, MAX_FILE_LIMIT);
    }

    private ProjectContextDto.ProjectSummary toProjectSummary(Project project) {
        ProjectContextDto.ProjectSummary summary = new ProjectContextDto.ProjectSummary();
        summary.setProjectId(project.getProjectId());
        summary.setProjectName(project.getProjectName());
        summary.setDescription(project.getDescription());
        summary.setProjectType(project.getProjectType());
        summary.setIsShare(project.getIsShare());
        summary.setInitStatus(project.getInitStatus());
        summary.setBuildIndex(project.getBuildIndex());
        summary.setIndexSkills(project.getIndexSkills());
        summary.setCloudResourceId(project.getCloudResourceId());
        summary.setCreateBy(project.getCreateBy());
        summary.setCreateTime(project.getCreateTime());
        return summary;
    }

    private List<ProjectContextDto.RepositorySummary> loadRepositories(Long projectId) {
        List<ProjectRepo> repos = projectRepoMapper.selectList(new LambdaQueryWrapper<ProjectRepo>()
            .eq(ProjectRepo::getProjectId, projectId)
            .orderByAsc(ProjectRepo::getRepoType)
            .orderByAsc(ProjectRepo::getRepoId));
        return repos.stream().map(repo -> {
            ProjectContextDto.RepositorySummary summary = new ProjectContextDto.RepositorySummary();
            summary.setRepoId(repo.getRepoId());
            summary.setRepoFullName(repo.getRepoFullName());
            summary.setRepoUrl(sanitizeRepoUrl(repo.getRepoUrl()));
            summary.setDefaultBranch(repo.getDefaultBranch());
            summary.setDescription(repo.getDescription());
            summary.setRepoType(repo.getRepoType());
            summary.setProvider(repo.getProvider());
            return summary;
        }).toList();
    }

    private void loadResources(Long projectId, Set<String> sections, ProjectContextDto result) {
        List<ProjectResource> bindings = projectResourceMapper.selectList(new LambdaQueryWrapper<ProjectResource>()
            .eq(ProjectResource::getProjectId, projectId)
            .and(item -> item.isNull(ProjectResource::getDeleteFlag)
                .or().ne(ProjectResource::getDeleteFlag, DeleteFlag.DELETED))
            .orderByAsc(ProjectResource::getSortNo)
            .orderByAsc(ProjectResource::getId));

        Set<Long> numericIds = bindings.stream()
            .map(ProjectResource::getResourceId)
            .filter(Objects::nonNull)
            .collect(Collectors.toCollection(LinkedHashSet::new));
        Map<Long, SsResource> resourcesById = ssResourceService.findByIdList(numericIds).stream()
            .collect(Collectors.toMap(SsResource::getResourceId, item -> item, (left, right) -> left, LinkedHashMap::new));

        for (ProjectResource binding : bindings) {
            SsResource resource = resourcesById.get(binding.getResourceId());
            ProjectContextDto.ResourceSummary summary = toResourceSummary(binding, resource);
            String bizType = StringUtils.upperCase(summary.getResourceBizType());
            if ("knowledge".equalsIgnoreCase(binding.getResourceType())
                || (bizType != null && KNOWLEDGE_TYPES.contains(bizType))) {
                if (sections.contains("knowledge")) result.getKnowledgeBases().add(summary);
                continue;
            }
            if (isOntology(binding, bizType)) {
                if (sections.contains("ontologies")) addOntology(result.getOntologies(), bizType, summary);
                continue;
            }
            if ("digital_employee".equalsIgnoreCase(binding.getResourceType())) {
                if (sections.contains("knowledge")) result.getDigitalEmployees().add(summary);
            } else if (sections.contains("knowledge")) {
                result.getOtherResources().add(summary);
            }
        }

        if (sections.contains("knowledge")) {
            result.getCounts().put("knowledgeBases", (long) result.getKnowledgeBases().size());
            result.getCounts().put("digitalEmployees", (long) result.getDigitalEmployees().size());
            result.getCounts().put("otherResources", (long) result.getOtherResources().size());
        }
        if (sections.contains("ontologies")) {
            ProjectContextDto.OntologySummary ontologies = result.getOntologies();
            result.getCounts().put("ontologyBases", (long) ontologies.getBases().size());
            result.getCounts().put("ontologyObjects", (long) ontologies.getObjects().size());
            result.getCounts().put("ontologyViews", (long) ontologies.getViews().size());
            result.getCounts().put("ontologyScenes", (long) ontologies.getScenes().size());
            result.getCounts().put("ontologyOthers", (long) ontologies.getOthers().size());
        }
    }

    private ProjectContextDto.ResourceSummary toResourceSummary(ProjectResource binding, SsResource resource) {
        ProjectContextDto.ResourceSummary summary = new ProjectContextDto.ResourceSummary();
        summary.setBindingType(binding.getResourceType());
        summary.setResourceId(binding.getResourceId());
        summary.setResourceName(resource == null
            ? binding.getResourceName()
            : StringUtils.defaultIfBlank(resource.getResourceName(), binding.getResourceName()));
        summary.setResourceBizType(resource == null ? null : resource.getResourceBizType());
        summary.setResourceCode(resource == null ? null : resource.getResourceCode());
        summary.setDescription(resource == null ? null : resource.getResourceDesc());
        summary.setParentResourceId(resource == null ? null : resource.getParentResourceId());
        summary.setAvailable(resource != null);
        return summary;
    }

    private boolean isOntology(ProjectResource binding, String bizType) {
        return "ontology".equalsIgnoreCase(binding.getResourceType())
            || (bizType != null && Set.of("ONTOLOGY_BASE", "OBJECT", "VIEW", "SCENE").contains(bizType));
    }

    private void addOntology(ProjectContextDto.OntologySummary ontology, String bizType,
                             ProjectContextDto.ResourceSummary summary) {
        if ("ONTOLOGY_BASE".equals(bizType)) {
            ontology.getBases().add(summary);
        } else if ("OBJECT".equals(bizType)) {
            ontology.getObjects().add(summary);
        } else if ("VIEW".equals(bizType)) {
            ontology.getViews().add(summary);
        } else if ("SCENE".equals(bizType)) {
            ontology.getScenes().add(summary);
        } else {
            ontology.getOthers().add(summary);
        }
    }

    private List<ProjectContextDto.MemberSummary> loadMembers(Long projectId) {
        List<ProjectMemberListDto> members = projectMemberService.listProjectMembers(
            projectId, null, CurrentUserHolder.getCurrentUserId());
        return members.stream().map(member -> {
            ProjectContextDto.MemberSummary summary = new ProjectContextDto.MemberSummary();
            summary.setUserId(member.getUserId());
            summary.setUserName(member.getUserName());
            summary.setUserNumber(member.getUserNumber());
            summary.setRole(member.getRole());
            summary.setAgentId(member.getAgentId());
            summary.setAgentName(member.getAgentName());
            return summary;
        }).toList();
    }

    private void loadSharedFiles(Long projectId, int limit, ProjectContextDto result) {
        long total = projectShareFileMapper.countContextFiles(projectId);
        List<ProjectContextSharedFileDto> files = total == 0
            ? Collections.emptyList()
            : projectShareFileMapper.listContextFiles(projectId, limit);
        List<ProjectContextDto.SharedFileSummary> summaries = new ArrayList<>(files.size());
        for (ProjectContextSharedFileDto file : files) {
            ProjectContextDto.SharedFileSummary summary = new ProjectContextDto.SharedFileSummary();
            summary.setFileId(file.getFileId());
            summary.setFileName(file.getFileName());
            summary.setFileType(file.getFileType());
            summary.setLength(file.getLength());
            summary.setContentType(file.getContentType());
            summary.setCreateBy(file.getCreateBy());
            summary.setChatId(file.getChatId());
            summary.setShareLink(file.getShareLink());
            summary.setCreateTime(file.getCreateTime());
            summaries.add(summary);
        }
        result.setSharedFiles(summaries);
        result.getCounts().put("sharedFiles", total);
        result.getTruncated().put("sharedFiles", total > summaries.size());
    }

    /** 防止历史仓库地址中意外保存的 URL user-info 被返回给模型。 */
    private String sanitizeRepoUrl(String repoUrl) {
        if (StringUtils.isBlank(repoUrl)) {
            return repoUrl;
        }
        int schemeEnd = repoUrl.indexOf("://");
        int atIndex = repoUrl.indexOf('@', schemeEnd + 3);
        if (schemeEnd >= 0 && atIndex > schemeEnd) {
            return repoUrl.substring(0, schemeEnd + 3) + repoUrl.substring(atIndex + 1);
        }
        return repoUrl;
    }

    private record Resolution(Long projectId, String resolvedBy) {
    }
}
