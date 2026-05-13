package com.iwhalecloud.byai.state.domain.chat.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.util.List;

@Data
@Schema(description = "推荐问题实体类")
public class SuggestionQuestionVo {

    @Schema(description = "入参问题")
    private String question;

    @Schema(description = "推荐问题列表")
    private List<String> relatedQuestions;


}
