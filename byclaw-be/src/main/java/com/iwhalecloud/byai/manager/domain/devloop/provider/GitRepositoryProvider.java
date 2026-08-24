package com.iwhalecloud.byai.manager.domain.devloop.provider;

import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoBranchDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoFileContentDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoTreeNodeDTO;
import java.util.List;

/**
 * 代码托管平台目录读取能力。
 * <p>应用服务只依赖此抽象，新增 GitLab 等平台时实现本接口即可，不把平台 API 细节带入 controller。</p>
 */
public interface GitRepositoryProvider {

    /** provider 标识，例如 github。 */
    String providerType();

    /** 查询指定仓库 ref 下的目录节点；provider 应优先使用 repoUrl，repoFullName 仅作兼容兜底。 */
    List<ProjectRepoTreeNodeDTO> listTree(String repoUrl, String repoFullName, String path, String ref,
        String accessToken);

    /** 按指定 ref 搜索仓库文件名和路径。 */
    List<ProjectRepoTreeNodeDTO> searchTree(String repoUrl, String repoFullName, String keyword, String ref,
        String accessToken);

    /** 查询仓库全部远程分支；provider 应优先使用 repoUrl，repoFullName 仅作兼容兜底。 */
    List<ProjectRepoBranchDTO> listBranches(String repoUrl, String repoFullName, String accessToken);

    /** 查询指定分支上的文件内容；provider 应优先使用 repoUrl，repoFullName 仅作兼容兜底。 */
    ProjectRepoFileContentDTO getFileContent(String repoUrl, String repoFullName, String branch, String path,
        String accessToken);
}
