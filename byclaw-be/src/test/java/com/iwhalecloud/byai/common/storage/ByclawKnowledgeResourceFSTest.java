package com.iwhalecloud.byai.common.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.io.InputStream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.iwhalecloud.byai.common.storage.model.StorageLocation;

@ExtendWith(MockitoExtension.class)
class ByclawKnowledgeResourceFSTest {

    @Mock
    private ObjectStorage objectStorage;

    @Test
    void init_initializesAndMountsPrivateKnowledgeBucket() {
        ByclawKnowledgeResourceFS fs = new ByclawKnowledgeResourceFS(objectStorage);

        fs.init();

        verify(objectStorage).init("byclaw-qa");
        verify(objectStorage).mount("byclaw-qa");
    }

    @Test
    void read_usesPrivateKnowledgeBucket() {
        ByclawKnowledgeResourceFS fs = new ByclawKnowledgeResourceFS(objectStorage);
        InputStream expected = new ByteArrayInputStream(new byte[] {1});
        when(objectStorage.get(any())).thenReturn(expected);

        InputStream actual = fs.read("/resource/kg_doc/KG_DOC_10001/.bykc/KB001/raw/origin/a.txt");

        assertThat(actual).isSameAs(expected);
        verify(objectStorage).get(StorageLocation.of("byclaw-fs", "byclaw-qa",
            "/resource/kg_doc/KG_DOC_10001/.bykc/KB001/raw/origin/a.txt", "private"));
    }
}
