package com.iwhalecloud.byai.manager.domain.devloop.provider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.util.OkHttpUtil;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoBranchDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoFileContentDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoTreeNodeDTO;
import lombok.extern.slf4j.Slf4j;
import okhttp3.Headers;
import okhttp3.Response;
import org.springframework.stereotype.Service;

import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;

/** GitHub Contents API 目录读取实现。 */
@Slf4j
@Service
public class GitHubRepositoryProvider implements GitRepositoryProvider {

    private static final String API_BASE = "https://api.github.com";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Override
    public String providerType() {
        return "github";
    }

    @Override
    public List<ProjectRepoTreeNodeDTO> listTree(String repoFullName, String path, String ref, String accessToken) {
        validateRepoName(repoFullName);
        requireToken(accessToken);
        String url = buildContentsUrl(repoFullName, path, ref);
        try (Response response = OkHttpUtil.getRequest(url, jsonHeaders(accessToken))) {
            if (response == null || response.body() == null) {
                throw new BaseException(50500, "devloop.github.no.response");
            }
            if (response.code() == 404) {
                throw new BaseException(50500, "devloop.github.repository.or.path.not.found");
            }
            if (!response.isSuccessful()) {
                throw new BaseException(50500, "devloop.github.http.failed");
            }
            JsonNode root = MAPPER.readTree(response.body().string());
            if (!root.isArray()) {
                throw new BaseException(50500, "devloop.github.path.is.file");
            }
            List<ProjectRepoTreeNodeDTO> nodes = new ArrayList<>();
            for (JsonNode item : root) {
                ProjectRepoTreeNodeDTO node = new ProjectRepoTreeNodeDTO();
                node.setName(item.path("name").asText());
                node.setPath(item.path("path").asText());
                node.setType("dir".equals(item.path("type").asText()) ? "directory" : "file");
                node.setSize(item.has("size") ? item.path("size").asLong() : null);
                node.setSha(item.path("sha").asText(null));
                node.setUrl(item.path("html_url").asText(null));
                node.setHasChildren("directory".equals(node.getType()));
                nodes.add(node);
            }
            nodes.sort(Comparator.comparing(ProjectRepoTreeNodeDTO::getType).thenComparing(ProjectRepoTreeNodeDTO::getName,
                String.CASE_INSENSITIVE_ORDER));
            return nodes;
        } catch (BaseException e) {
            throw e;
        } catch (Exception e) {
            log.error("GitHub repository tree query failed: repo={}, path={}, ref={}", repoFullName, path, ref, e);
            throw new BaseException(50500, "devloop.github.tree.query.failed");
        }
    }

    @Override
    public List<ProjectRepoBranchDTO> listBranches(String repoFullName, String accessToken) {
        validateRepoName(repoFullName);
        requireToken(accessToken);
        List<ProjectRepoBranchDTO> branches = new ArrayList<>();
        int page = 1;
        while (true) {
            String url = API_BASE + "/repos/" + repoFullName.trim() + "/branches?per_page=100&page=" + page;
            try (Response response = OkHttpUtil.getRequest(url, jsonHeaders(accessToken))) {
                JsonNode root = readSuccessfulJson(response, "devloop.github.branches.query.failed");
                if (!root.isArray()) {
                    throw new BaseException(50500, "devloop.github.branches.query.failed");
                }
                for (JsonNode item : root) {
                    ProjectRepoBranchDTO branch = new ProjectRepoBranchDTO();
                    branch.setName(item.path("name").asText());
                    branch.setSha(item.path("commit").path("sha").asText(null));
                    branch.setProtectedBranch(item.path("protected").asBoolean(false));
                    branches.add(branch);
                }
                if (root.size() < 100) break;
                page++;
            } catch (BaseException e) {
                throw e;
            } catch (Exception e) {
                log.error("GitHub branches query failed: repo={}, page={}", repoFullName, page, e);
                throw new BaseException(50500, "devloop.github.branches.query.failed");
            }
        }
        return branches;
    }

    @Override
    public ProjectRepoFileContentDTO getFileContent(String repoFullName, String branch, String path,
        String accessToken) {
        validateRepoName(repoFullName);
        requireToken(accessToken);
        if (branch == null || branch.trim().isEmpty()) {
            throw new BaseException(50500, "project.repo.branch.required");
        }
        if (path == null || path.trim().isEmpty()) {
            throw new BaseException(50500, "project.repo.file.path.required");
        }
        String url = buildContentsUrl(repoFullName, path, branch);
        try (Response response = OkHttpUtil.getRequest(url, jsonHeaders(accessToken))) {
            JsonNode root = readSuccessfulJson(response, "devloop.github.file.query.failed");
            if (!"file".equals(root.path("type").asText())) {
                throw new BaseException(50500, "project.repo.path.not.file");
            }
            String encodedContent = root.path("content").asText("").replace("\n", "").replace("\r", "");
            byte[] bytes = encodedContent.isEmpty() ? readRawFile(url, accessToken) : Base64.getDecoder().decode(encodedContent);
            ProjectRepoFileContentDTO result = new ProjectRepoFileContentDTO();
            result.setName(root.path("name").asText());
            result.setPath(root.path("path").asText());
            result.setBranch(branch.trim());
            result.setSha(root.path("sha").asText(null));
            result.setSize(root.path("size").asLong(bytes.length));
            result.setUrl(root.path("html_url").asText(null));
            result.setDownloadUrl(root.path("download_url").asText(null));
            String text = decodeUtf8(bytes);
            result.setBinary(text == null);
            result.setContent(text);
            result.setBase64Content(text == null ? Base64.getEncoder().encodeToString(bytes) : null);
            return result;
        } catch (BaseException e) {
            throw e;
        } catch (Exception e) {
            log.error("GitHub file query failed: repo={}, branch={}, path={}", repoFullName, branch, path, e);
            throw new BaseException(50500, "devloop.github.file.query.failed");
        }
    }

    private JsonNode readSuccessfulJson(Response response, String errorKey) throws Exception {
        if (response == null || response.body() == null) {
            throw new BaseException(50500, "devloop.github.no.response");
        }
        if (response.code() == 404) {
            throw new BaseException(50500, "devloop.github.repository.or.path.not.found");
        }
        if (!response.isSuccessful()) {
            throw new BaseException(50500, errorKey);
        }
        return MAPPER.readTree(response.body().string());
    }

    private byte[] readRawFile(String url, String accessToken) throws Exception {
        Headers headers = new Headers.Builder().add("Authorization", "Bearer " + accessToken.trim())
            .add("Accept", "application/vnd.github.raw+json").add("X-GitHub-Api-Version", "2022-11-28").build();
        try (Response response = OkHttpUtil.getRequest(url, headers)) {
            if (response == null || response.body() == null || !response.isSuccessful()) {
                throw new BaseException(50500, "devloop.github.file.query.failed");
            }
            return response.body().bytes();
        }
    }

    private String decodeUtf8(byte[] bytes) {
        for (byte value : bytes) {
            if (value == 0) return null;
        }
        try {
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException e) {
            return null;
        }
    }

    private String buildContentsUrl(String repoFullName, String path, String ref) {
        StringBuilder url = new StringBuilder(API_BASE).append("/repos/").append(repoFullName.trim())
            .append("/contents");
        if (path != null && !path.trim().isEmpty()) {
            for (String segment : path.trim().split("/")) {
                if (!segment.isEmpty() && !".".equals(segment) && !"..".equals(segment)) {
                    url.append('/').append(encode(segment));
                }
            }
        }
        if (ref != null && !ref.trim().isEmpty()) {
            url.append("?ref=").append(encode(ref.trim()));
        }
        return url.toString();
    }

    private Headers jsonHeaders(String accessToken) {
        return new Headers.Builder().add("Authorization", "Bearer " + accessToken.trim())
            .add("Accept", "application/vnd.github+json").add("X-GitHub-Api-Version", "2022-11-28").build();
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private void requireToken(String accessToken) {
        if (accessToken == null || accessToken.trim().isEmpty()) {
            throw new BaseException(50500, "devloop.github.token.not.configured");
        }
    }

    private void validateRepoName(String repoFullName) {
        if (repoFullName == null || !repoFullName.matches("[^/\\s]+/[^/\\s]+")) {
            throw new BaseException(50500, "project.repo.name.invalid");
        }
    }
}
