package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkMessageDownloadInfo;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkMessageFileDownloadResult;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkMsgType;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.support.DingtalkDownloadedMultipartFile;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.manager.dto.session.SessionUploadResult;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.apache.commons.collections.CollectionUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.*;

@Service
public class DingtalkFileDownloadService {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkFileDownloadService.class);
    private static final String MESSAGE_FILE_DOWNLOAD_URL = "https://api.dingtalk.com/v1.0/robot/messageFiles/download";
    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json; charset=utf-8");

    private final ObjectMapper objectMapper;
    private final OkHttpClient okHttpClient = new OkHttpClient();

    @Autowired
    private DingtalkTokenService dingtalkTokenService;
    @Autowired
    private DingtalkUserService dingtalkUserService;
    @Autowired
    private com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService assistantChatApplicationService;

    public DingtalkFileDownloadService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public DingtalkMessageFileDownloadResult downloadMessageFile(String accessToken,  String robotCode, DingtalkMessageDownloadInfo downloadInfo) {
        if (!StringUtils.hasText(accessToken)) {
            throw new IllegalStateException("DingTalk accessToken is empty");
        }
        if (!StringUtils.hasText(downloadInfo.getDownloadCode())) {
            throw new IllegalStateException("DingTalk downloadCode is empty");
        }
        if (!StringUtils.hasText(robotCode)) {
            throw new IllegalStateException("DingTalk robotCode is empty");
        }

        try {
            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("downloadCode", downloadInfo.getDownloadCode());
            requestBody.put("robotCode", robotCode);

            Request request = new Request.Builder()
                    .url(MESSAGE_FILE_DOWNLOAD_URL)
                    .addHeader("x-acs-dingtalk-access-token", accessToken)
                    .addHeader("Content-Type", "application/json")
                    .post(RequestBody.create(objectMapper.writeValueAsString(requestBody), JSON_MEDIA_TYPE))
                    .build();

            try (Response response = okHttpClient.newCall(request).execute()) {
                String responseBody = readResponseBody(response);
                if (!response.isSuccessful()) {
                    throw new IllegalStateException("Download DingTalk message file failed, httpCode="
                            + response.code() + ", body=" + responseBody);
                }

                JsonNode root = objectMapper.readTree(responseBody);
                if (root.has("code") && root.get("code").asInt(0) != 0) {
                    throw new IllegalStateException("Download DingTalk message file failed, code="
                            + root.path("code").asText() + ", message=" + root.path("message").asText());
                }

                JsonNode resultNode = root.has("result") ? root.get("result") : root;
                DingtalkMessageFileDownloadResult result = new DingtalkMessageFileDownloadResult();
                result.setDownloadUrl(getText(resultNode, "downloadUrl"));
                result.setContentType(getText(resultNode, "contentType"));
                result.setFileName(getText(
                    resultNode,
                    "fileName",
                    downloadInfo.getFileName()
                ));

                if (!StringUtils.hasText(result.getDownloadUrl())) {
                    throw new IllegalStateException("Download DingTalk message file failed, downloadUrl is empty");
                }
                return result;
            }
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    public byte[] downloadMessageFileBinary(DingtalkMessageFileDownloadResult downloadResult) {
        if (downloadResult == null || !StringUtils.hasText(downloadResult.getDownloadUrl())) {
            throw new IllegalStateException("DingTalk downloadUrl is empty");
        }

        Request.Builder requestBuilder = new Request.Builder()
                .url(downloadResult.getDownloadUrl())
                .get();

        Request request = requestBuilder.build();
        try (Response response = okHttpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IllegalStateException("Download DingTalk file binary failed, httpCode=" + response.code());
            }
            ResponseBody body = response.body();
            if (body == null) {
                throw new IllegalStateException("Download DingTalk file binary failed, empty body");
            }
            byte[] bytes = body.bytes();

            if (downloadResult.getFileSize() == null) {
                downloadResult.setFileSize((long) bytes.length);
            }
            if (!StringUtils.hasText(downloadResult.getContentType())) {
                MediaType contentType = body.contentType();
                if (contentType != null) {
                    downloadResult.setContentType(contentType.toString());
                }
            }
            if (StringUtils.hasText(downloadResult.getFileName()) && !downloadResult.getFileName().contains(".")) {
                String ext = extractExtensionFromContentType(downloadResult.getContentType());
                if (ext != null) {
                    downloadResult.setFileName(downloadResult.getFileName() + "." + ext);
                }
            }
            logger.info("downloadMessageFileBinary downloadResult={}, fileName={}", downloadResult, downloadResult.getFileName());

            return bytes;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    public List<MessageFileDto> downloadMessageFiles(DingtalkCallbackMessage DDMessage, AssistantChatDto assistantChatDto) {
        List<DingtalkMessageDownloadInfo> downloadInfos = extractDownloadInfos(DDMessage);
        String senderStaffId = DDMessage.getSenderStaffId();
        String robotCode = DDMessage.getRobotCode();
        String msgType = DDMessage.getMsgtype();
        if (downloadInfos.isEmpty()) {
            return Collections.emptyList();
        }

        String accessToken = dingtalkTokenService.getAccessToken(senderStaffId, robotCode);

        List<MultipartFile> multipartFiles = new ArrayList<>();
        int idx = 0;
        for (DingtalkMessageDownloadInfo downloadInfo : downloadInfos) {
            DingtalkMessageFileDownloadResult downloadResult;
            if (StringUtils.hasText(downloadInfo.getDownloadUrl())) {
                downloadResult = new DingtalkMessageFileDownloadResult();
                downloadResult.setDownloadUrl(downloadInfo.getDownloadUrl());
                downloadResult.setFileName(downloadInfo.getFileName());
            } else {
                downloadResult = downloadMessageFile(accessToken, robotCode, downloadInfo);
            }
            logger.info("downloadMessageFiles={}, downloadCode={}", downloadResult, downloadInfo.getDownloadCode());

            byte[] fileBytes = downloadMessageFileBinary(downloadResult);

            String fileName = downloadResult.getFileName();
            String contentType = downloadResult.getContentType();

            multipartFiles.add(new DingtalkDownloadedMultipartFile(
                    "file" + (idx++), fileName, contentType, fileBytes));
        }

        if (multipartFiles.isEmpty()) {
            return Collections.emptyList();
        }

        try {
            SessionUploadResult uploadResult =
                assistantChatApplicationService.uploadFiles(
                        multipartFiles.toArray(new MultipartFile[0]),
                        assistantChatDto.getSessionId(),
                        SessionType.H_AS.getCode(),
                        assistantChatDto.getAgentId()
                );

            if (uploadResult != null && uploadResult.getSessionId() != null) {
                assistantChatDto.setSessionId(uploadResult.getSessionId());
            }

            List<MessageFileDto> messageFiles = new ArrayList<>();
            if (uploadResult != null && CollectionUtils.isNotEmpty(uploadResult.getUploadItems())) {
                for (com.iwhalecloud.byai.manager.dto.resource.UploadItem item : uploadResult.getUploadItems()) {
                    MessageFileDto dto = new MessageFileDto();
                    dto.setFileId(item.getFileId() == null ? null : String.valueOf(item.getFileId()));
                    dto.setFileName(item.getFileName());
                    dto.setFilePath(item.getFilePath());
                    dto.setFileUrl(item.getFileUrl());
                    if (DingtalkMsgType.PICTURE.matches(msgType) || DingtalkMsgType.RICH_TEXT.matches(msgType)) {
                        dto.setFileType("image");
                        // dto.setFileType("file");
                    } else {
                        dto.setFileType("file");
                    }
                    // dto.setUseType("content");
                    messageFiles.add(dto);
                }
            }
            return messageFiles;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    public List<DingtalkMessageDownloadInfo> extractDownloadInfos(DingtalkCallbackMessage DDMessage) {
        Map<String, DingtalkMessageDownloadInfo> downloadInfoMap = new LinkedHashMap<>();

        String msgtype = DDMessage.getMsgtype();
        if (DingtalkMsgType.RICH_TEXT.matches(msgtype)) {
            collectRichTextDownloadInfos(DDMessage, downloadInfoMap);
        } else if (DingtalkMsgType.INTERACTIVE_CARD.matches(msgtype)) {
            collectInteractiveCardDownloadInfos(DDMessage, downloadInfoMap);
        } else if (hasDirectContentDownloadCode(msgtype)) {
            collectDownloadInfoFromMap(DDMessage, downloadInfoMap);
        } 

        return new ArrayList<>(downloadInfoMap.values());
    }

    private boolean hasDirectContentDownloadCode(String msgtype) {
        return DingtalkMsgType.PICTURE.matches(msgtype)
                || DingtalkMsgType.VIDEO.matches(msgtype)
                || DingtalkMsgType.FILE.matches(msgtype);
    }

    private void collectDownloadInfoFromMap(DingtalkCallbackMessage DDMessage, Map<String, DingtalkMessageDownloadInfo> downloadInfoMap) {
        Object contentNode = DDMessage.getContent();

        if (!(contentNode instanceof Map<?, ?> nodeMap)) {
            return;
        }
        addDownloadInfo(nodeMap, null, DDMessage, downloadInfoMap);
    }

    private void collectRichTextDownloadInfos(DingtalkCallbackMessage DDMessage, Map<String, DingtalkMessageDownloadInfo> downloadInfoMap) {
        Object contentNode = DDMessage.getContent();

        if (!(contentNode instanceof Map<?, ?> contentMap)) {
            return;
        }
        Object richTextNode = contentMap.get("richText");
        if (!(richTextNode instanceof Collection<?> richTextItems)) {
            return;
        }

        StringBuilder textBuilder = new StringBuilder();
        for (Object richTextItem : richTextItems) {
            if (!(richTextItem instanceof Map<?, ?> itemMap)) {
                continue;
            }

            Object text = itemMap.get("text");
            if (text != null) {
                String textValue = String.valueOf(text);
                if (!textValue.isBlank()) {
                    if (textBuilder.length() > 0) {
                        textBuilder.append('\n');
                    }
                    textBuilder.append(textValue);
                }
            }

            Object typeNode = itemMap.get("type");
            String itemType = typeNode == null ? null : String.valueOf(typeNode);
            addDownloadInfo(itemMap, itemType, DDMessage, downloadInfoMap);
        }

        if (textBuilder.length() > 0) {
            DDMessage.setTextContent(textBuilder.toString());
        }
    }

    private void collectInteractiveCardDownloadInfos(DingtalkCallbackMessage DDMessage, Map<String, DingtalkMessageDownloadInfo> downloadInfoMap) {
        return;
        // Object contentNode = DDMessage.getContent();
        // if (!(contentNode instanceof Map<?, ?> nodeMap)) {
        //     return;
        // }
        // Object bizCustomActionUrlNode = nodeMap.get("biz_custom_action_url");
        // if (bizCustomActionUrlNode == null) {
        //     return;
        // }

        // String actionUrl = String.valueOf(bizCustomActionUrlNode);
        // if (actionUrl.isBlank()) {
        //     return;
        // }

        // String senderStaffId = DDMessage.getSenderStaffId();
        // String robotCode = DDMessage.getRobotCode();
        // String msgtype = DDMessage.getMsgtype();

        // if (actionUrl.startsWith("http://") || actionUrl.startsWith("https://")) {
        //     String fileName = resolveDownloadFileName(null, msgtype, robotCode);
        //     DingtalkMessageDownloadInfo info = new DingtalkMessageDownloadInfo(null, fileName);
        //     info.setDownloadUrl(actionUrl);
        //     downloadInfoMap.putIfAbsent("directUrl:" + actionUrl, info);
        //     return;
        // }

        // String spaceId = extractUrlParam(actionUrl, "spaceId");
        // String fileId = extractUrlParam(actionUrl, "fileId");
        // if (!StringUtils.hasText(spaceId) || !StringUtils.hasText(fileId)) {
        //     logger.warn("InteractiveCard missing spaceId or fileId. actionUrl={}", actionUrl);
        //     return;
        // }

        // String accessToken = dingtalkTokenService.getAccessToken(senderStaffId, robotCode);
        // String unionId = dingtalkUserService.getUserDetail(accessToken, senderStaffId).getUnionid();

        // String resourceUrl = fetchDriveFileDownloadUrl(accessToken, spaceId, fileId, unionId);
        // if (!StringUtils.hasText(resourceUrl)) {
        //     logger.warn("Failed to get drive file resourceUrl. spaceId={}, fileId={}", spaceId, fileId);
        //     return;
        // }

        // String fileName = resolveDownloadFileName(extractUrlParam(actionUrl, "fileName"), msgtype, robotCode);
        // DingtalkMessageDownloadInfo info = new DingtalkMessageDownloadInfo(null, fileName);
        // info.setDownloadUrl(resourceUrl);
        // downloadInfoMap.putIfAbsent(spaceId + ":" + fileId, info);
    }

    // private String fetchDriveFileDownloadUrl(String accessToken, String spaceId, String fileId, String unionId) {
    //     String url = "https://api.dingtalk.com/v1.0/drive/spaces/" + spaceId + "/files/" + fileId + "/downloadInfos?unionId=" + unionId;
    //     Request request = new Request.Builder()
    //             .url(url)
    //             .addHeader("x-acs-dingtalk-access-token", accessToken)
    //             .addHeader("Content-Type", "application/json")
    //             .get()
    //             .build();
    //     try (Response response = okHttpClient.newCall(request).execute()) {
    //         String body = readResponseBody(response);
    //         if (!response.isSuccessful()) {
    //             logger.error("Fetch drive file download info failed. httpCode={}, body={}", response.code(), body);
    //             return null;
    //         }
    //         JsonNode root = objectMapper.readTree(body);
    //         return root.path("downloadInfo").path("resourceUrl").asText(null);
    //     } catch (IOException e) {
    //         throw new IllegalStateException(e);
    //     }
    // }

    // private String extractUrlParam(String url, String paramName) {
    //     if (url == null) {
    //         return null;
    //     }
    //     int queryStart = url.indexOf('?');
    //     String query = queryStart >= 0 ? url.substring(queryStart + 1) : url;
    //     for (String param : query.split("&")) {
    //         String[] kv = param.split("=", 2);
    //         if (kv.length == 2 && kv[0].equals(paramName)) {
    //             return kv[1];
    //         }
    //     }
    //     return null;
    // }

    private void addDownloadInfo(
        Map<?, ?> itemMap,
        String itemType,
        DingtalkCallbackMessage DDMessage,
        Map<String, DingtalkMessageDownloadInfo> downloadInfoMap
    ) {
        Object downloadCodeNode = itemMap.get("downloadCode");
        Object fileNameNode = itemMap.get("fileName");

        String msgtype = itemType != null ? itemType : DDMessage.getMsgtype();
        String robotCode = DDMessage.getRobotCode();

        if (downloadCodeNode == null) {
            return;
        }
        String downloadCode = String.valueOf(downloadCodeNode);
        if (downloadCode.isBlank()) {
            return;
        }
        String rawFileName = fileNameNode == null ? null : String.valueOf(fileNameNode);
        String fileName = resolveDownloadFileName(rawFileName, msgtype, robotCode);
        downloadInfoMap.putIfAbsent(downloadCode, new DingtalkMessageDownloadInfo(downloadCode, fileName));
    }

    private String resolveDownloadFileName(String rawFileName, String msgtype, String robotCode) {
        if (!StringUtils.hasText(rawFileName)) {
            String defaultName = robotCode + "_" + System.currentTimeMillis();
            if (DingtalkMsgType.PICTURE.matches(msgtype) || DingtalkMsgType.RICH_TEXT.matches(msgtype)) {
                defaultName += ".png";
            } else if (DingtalkMsgType.VIDEO.matches(msgtype)) {
                defaultName += ".mp4";
            }
            return defaultName;
        }

        return rawFileName;
    }

    private String extractExtensionFromContentType(String contentType) {
        if (!StringUtils.hasText(contentType)) {
            return null;
        }
        String mimeType = contentType.split(";")[0].trim();
        int slashIdx = mimeType.indexOf('/');
        if (slashIdx < 0 || slashIdx == mimeType.length() - 1) {
            return null;
        }
        return mimeType.substring(slashIdx + 1);
    }

    private String readResponseBody(Response response) throws IOException {
        ResponseBody responseBody = response.body();
        return responseBody == null ? "" : responseBody.string();
    }

    private String getText(JsonNode node, String fieldName) {
        return getText(node, fieldName, null);
    }

    private String getText(JsonNode node, String fieldName, String defaultValue) {
        JsonNode valueNode = node.get(fieldName);
        return valueNode == null || valueNode.isNull() ? defaultValue : valueNode.asText();
    }
}
