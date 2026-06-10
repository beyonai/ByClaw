package com.iwhalecloud.byai.state.application.service.filebrowser;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;

import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;

public interface FileBrowserProvider {

    List<FileBrowserItemVo> list(String userCode, Long resourceId, String relativePath);

    void upload(String userCode, Long resourceId, String relativePath, MultipartFile[] files) throws Exception;

    InputStream download(String userCode, Long resourceId, String relativePath);

    void delete(String userCode, Long resourceId, List<String> relativePaths);

    void rename(String userCode, Long resourceId, String sourcePath, String newName);

    void move(String userCode, Long resourceId, List<String> sourcePaths, String targetDirectory);

    void createFolder(String userCode, Long resourceId, String relativePath);

    List<FileBrowserItemVo> search(String userCode, Long resourceId, String relativePath, String keyword);

    void downloadFolder(String userCode, Long resourceId, String relativePath, OutputStream outputStream) throws IOException;
}
