package com.iwhalecloud.byai.state.domain.groupchat.forward;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.ForwardStreamAdmission;
import static org.mockito.Mockito.*;
/** File/proxy fixtures control only distributed admission; their actual byte and JDBC boundaries remain real. */
final class ForwardAdmissionFixture {
    static ForwardStreamAdmission admission(){var admission=mock(ForwardStreamAdmission.class);when(admission.acquire(any())).thenAnswer(i->mock(ForwardStreamAdmission.Permit.class));return admission;}
}
