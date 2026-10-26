package com.iwhalecloud.byai.state.application.service.filebrowser;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;

import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;

public interface FileBrowserProvider {

    List<FileBrowserItemVo> list(String userCode, Long resourceId, String relativePath);

    /** 复制时读取失败必须抛错，不能被当作空目录保存成功。 */
    default List<FileBrowserItemVo> listForTransfer(String userCode, Long resourceId, String relativePath) {
        return list(userCode, resourceId, relativePath);
    }

    /** 对象存储通过父级前缀判断目录；沙箱提供方可直接探测目标，避免依赖根目录可枚举。 */
    default boolean folderExists(String userCode, Long resourceId, String parentPath, String folderName) {
        return listForTransfer(userCode, resourceId, parentPath).stream()
            .anyMatch(item -> item.isDir() && folderName.equals(item.getName()));
    }

    void upload(String userCode, Long resourceId, String relativePath, MultipartFile[] files) throws Exception;

    InputStream download(String userCode, Long resourceId, String relativePath);

    void delete(String userCode, Long resourceId, List<String> relativePaths);

    void rename(String userCode, Long resourceId, String sourcePath, String newName);

    void move(String userCode, Long resourceId, List<String> sourcePaths, String targetDirectory);

    void copy(String userCode, Long resourceId, String sourcePath, String targetDirectory);

    void createFolder(String userCode, Long resourceId, String relativePath);

    List<FileBrowserItemVo> search(String userCode, Long resourceId, String relativePath, String keyword);

    void downloadFolder(String userCode, Long resourceId, String relativePath, OutputStream outputStream) throws IOException;
}
