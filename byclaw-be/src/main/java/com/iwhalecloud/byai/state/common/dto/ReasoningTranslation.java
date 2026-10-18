package com.iwhalecloud.byai.state.common.dto;

import lombok.Getter;
import lombok.Setter;

/** Display-only translation checkpoint. The source remains in choices[].delta.content. */
@Getter
@Setter
public class ReasoningTranslation {
    private Long seq;
    private String text = "";
    private int sourceLength;
    private long revision;
    private String status = "pending";
}
