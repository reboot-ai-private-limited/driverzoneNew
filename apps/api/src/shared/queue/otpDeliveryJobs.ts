import type { Role } from '@driverzone/contracts';
import { getQueue, QUEUE_NAMES } from './queues.js';
import { getRequestId } from '../http/request-context.js';

/**
 * The notifications queue's job vocabulary — currently one job: "did that OTP arrive?".
 *
 * **THE FIRST CONSUMER THIS QUEUE HAS EVER HAD.** `QUEUE_NAMES.notifications` has been declared
 * since the queues module was written and nothing ever read from it; `worker.ts` built a worker
 * for `dispatch` alone. That is why the worker gains a second `new Worker(...)` alongside this.
 *
 * WHY A DELAYED JOB RATHER THAN A POLL INSIDE THE SEND. The status only becomes interesting a few
 * seconds after the message goes out, and `POST /auth/otp/send` is a request a human is waiting
 * on with a spinner. Holding it open for ten seconds to watch a status move would make every
 * successful login as slow as the rare failing one.
 */

export const OTP_JOBS = {
  /** Read the WhatsApp message's delivery state; send an SMS if it never arrived. */
  checkDelivery: 'otp-check-delivery',
} as const;

/**
 * How long to wait before asking.
 *
 * Long enough for a healthy message to reach a handset and report back — `delivered` usually
 * lands within a couple of seconds — and short enough that a customer who is going to need the
 * SMS is not left staring at an empty inbox. Ten seconds is also about as long as somebody will
 * wait before reaching for "Get code by SMS" themselves, which is the manual version of this.
 */
export const OTP_DELIVERY_CHECK_DELAY_MS = 10_000;

export interface OtpDeliveryJobData {
  messageId: string;
  role: Role;
  phone: string;
  /**
   * The code, in plaintext, for the ~10 seconds this job is pending.
   *
   * **A DELIBERATE, BOUNDED WEAKENING.** Everywhere else the code exists only as
   * `hashOtpCode(code, OTP_PEPPER)`, so a Redis dump yields nothing usable; here it sits in a job
   * payload in the same Redis. The alternative — having the job mint a NEW code and overwrite the
   * stored challenge — keeps that property but creates a worse failure: a WhatsApp message that
   * arrives a moment late is then invalid, and the customer is typing a code the server has just
   * discarded.
   *
   * It is bounded: the job carries `removeOnComplete`/`removeOnFail`, the delay is seconds, and
   * the code is dead after `OTP_TTL_SECONDS` regardless. Revisit if Redis stops being trusted
   * with the challenge itself, at which point both facts change together.
   */
  code: string;
  requestId?: string | undefined;
}

/**
 * Schedule the check. Fire-and-forget by design — see `WaAgentOtpSender.onSent`, which swallows a
 * failure here rather than turning a message that DID go out into a 500 for the customer.
 */
export async function enqueueOtpDeliveryCheck(data: {
  messageId: string;
  role: Role;
  phone: string;
  code: string;
}): Promise<void> {
  await getQueue(QUEUE_NAMES.notifications).add(
    OTP_JOBS.checkDelivery,
    { ...data, requestId: getRequestId() } satisfies OtpDeliveryJobData,
    {
      /*
       * KEYED ON THE MESSAGE ID, so a retried send cannot schedule two checks for one message and
       * send two SMS. Hyphens only — BullMQ rejects a custom id containing a colon, and a `wamid`
       * is base64 that may contain `=` and `/` but never `:`.
       */
      jobId: `otp-delivery-${data.messageId.replace(/:/g, '-')}`,
      delay: OTP_DELIVERY_CHECK_DELAY_MS,
      removeOnComplete: true,
      // A handful, not 500: these carry a plaintext code, so failed jobs should not linger.
      removeOnFail: 20,
    },
  );
}
