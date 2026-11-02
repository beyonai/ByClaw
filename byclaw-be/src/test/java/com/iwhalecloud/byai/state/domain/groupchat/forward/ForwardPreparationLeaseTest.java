package com.iwhalecloud.byai.state.domain.groupchat.forward;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.ForwardPreparationLease;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.AttachmentCheckpointWriter;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.concurrent.*;
class ForwardPreparationLeaseTest {
    TargetLease lease(Instant until){return new TargetLease(1,2,new ForwardActor(3,4),5,6,"claim",7,until,ForwardState.COPYING);}
    @Test void handoffWaitsForInflightRenewalAndReturnsItsAcknowledgedLease()throws Exception{
        var initial=lease(Instant.now().plusSeconds(120));var next=lease(initial.leaseUntil().plusSeconds(60));var writer=mock(AttachmentCheckpointWriter.class);var entered=new CountDownLatch(1);var release=new CountDownLatch(1);when(writer.renewTarget(any(),any())).thenAnswer(i->{entered.countDown();release.await(5,TimeUnit.SECONDS);return next;});
        try(var holder=new ForwardPreparationLease(initial,writer,Duration.ofMinutes(1));var executor=Executors.newFixedThreadPool(2)){
            var renewal=executor.submit(holder::renew);assertThat(entered.await(2,TimeUnit.SECONDS)).isTrue();var handoff=executor.submit(holder::handoff);Thread.sleep(30);assertThat(handoff.isDone()).isFalse();release.countDown();renewal.get(2,TimeUnit.SECONDS);assertThat(handoff.get(2,TimeUnit.SECONDS)).isEqualTo(next);assertThatThrownBy(holder::current).hasMessage("FORWARD_LEASE_LOST");holder.renew();verify(writer,times(1)).renewTarget(initial,Duration.ofMinutes(1));
        }
    }
    @Test void unknownRenewalOutcomeSealsPreparationAndCannotStartCopy(){var writer=mock(AttachmentCheckpointWriter.class);when(writer.renewTarget(any(),any())).thenThrow(new IllegalStateException("ambiguous transport"));try(var holder=new ForwardPreparationLease(lease(Instant.now().plusSeconds(120)),writer,Duration.ofMinutes(1))){holder.renew();assertThatThrownBy(holder::handoff).hasMessage("ambiguous transport");assertThatThrownBy(holder::current).hasMessage("ambiguous transport");}}
}
