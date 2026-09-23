import type { OtpChannel, Role } from '@driverzone/contracts';
import { logger } from '@/shared/logging/logger.js';
import { AppError } from '@/shared/errors/AppError.js';
import type { OtpSenderPort } from '../domain/otpSender.port.js';

/**
 * INFRASTRUCTURE — the WhatsApp OTP sender, through waagent.in's Cloud-API-shaped endpoint.
 *
 * Replaces wabridge (`otpSender.whatsapp.ts`), which is retained and reachable until this is
 * proven against real numbers — see the precedence in `identity.container.ts`.
 *
 * **THE TEMPLATE'S SHAPE IS CONFIGURATION, NOT A GUESS**, because none of it can be read from
 * this side and each part fails differently:
 *
 *   - the NAME, not the id — an id gives `404 TEMPLATE_NOT_FOUND` naming the value,
 *   - the LANGUAGE, exactly as approved — `en` and `en_US` are separate rows, same 404,
 *   - the VARIABLE KEYS, which are the template's own tokens rather than positions — a mismatch
 *     gives `422 MESSAGE_VARIABLES_INCOMPLETE` naming the variable it still wants.
 *
 * `GET /v1/templates` answers all three at once: it lists each template's `id`, `name`,
 * `language`, and its `variables[].id` tokens. Reach for it before guessing.
 *
 * **NONE OF THAT IS THE WHOLE STORY.** A message can satisfy every one of the above, return
 * `200` with a `wamid`, and still never arrive — a WhatsApp Business Account with no valid
 * payment method fails at Meta with `131042 Business eligibility payment issue`, after
 * acceptance. That failure is invisible here and is exactly why `onSent` exists.
 *
 * **`onSent` IS HOW DELIVERY GETS CHECKED.** A 200 here means waagent ACCEPTED the message, not
 * that WhatsApp delivered it — a number with no WhatsApp account fails exactly this way. The
 * returned `wamid` is handed to the callback so the caller can schedule a status check and fall
 * back to SMS; see `otpDeliveryJobs.ts`. It is optional, and without it this is an ordinary
 * fire-and-forget sender.
 */

export interface WaAgentOtpConfig {
  apiUrl: string;
  apiKey: string | undefined;
  /**
   * The template's NAME, not its id.
   *
   * The field is called `name` and it means it — sending the id from `GET /v1/templates` returns
   * `404 TEMPLATE_NOT_FOUND`, naming the value it could not resolve. `GET /v1/templates` is the
   * place to read the right one; it lists `id` and `name` side by side.
   */
  phoneNumberId: string | undefined;
  template: string | undefined;
  /** Must match the template's approved language exactly — `en` and `en_US` are different rows. */
  languageCode: string;
  /**
   * The key the code goes under in `template.variables`.
   *
   * **KEYED BY THE TEMPLATE'S OWN TOKEN, NOT BY POSITION.** waagent's quickstart shows
   * `"body.1"`, which reads as positional and is what a Cloud API user would expect — but a
   * template whose variable is declared with a token answers `422 MESSAGE_VARIABLES_INCOMPLETE:
   * Missing values for template variable(s): code` to both `body.1` and `body.code`. The key it
   * wants is the bare token, `code`. `GET /v1/templates` reports it as `variables[].id`.
   *
   * So this is configuration rather than a constant: the two spellings are both real, and which
   * one applies is a property of the approved template.
   */
  codeVariable: string;
  /**
   * The key for the "call this number if you did not request a code" value, when the template has
   * one. Unset for a template whose only variable is the code.
   */
  contactVariable: string | undefined;
  contactNumber: string;
  /**
   * The key for a button that needs the code a second time — an authentication template's
   * copy-code or one-tap autofill button. Unset when the button takes no variable of its own.
   */
  buttonVariable: string | undefined;
  /**
   * Called with the provider's message id once it has accepted the send. The hook is what turns
   * "accepted" into "delivered or fall back"; it must never reject the send, so the caller is
   * expected to swallow its own failures.
   */
  onSent?:
    ((handle: { messageId: string; role: Role; phone: string; code: string }) => void) | undefined;
}

export class WaAgentOtpSender implements OtpSenderPort {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly phoneNumberId: string;
  private readonly template: string;

  constructor(
    private readonly config: WaAgentOtpConfig,
    private readonly timeoutMs: number = 10_000,
  ) {
    this.apiUrl = config.apiUrl;
    this.apiKey = demand(config.apiKey, 'WA_AGENT_API_KEY');
    this.phoneNumberId = demand(config.phoneNumberId, 'WA_AGENT_PHONE_NUMBER_ID');
    this.template = demand(config.template, 'WA_AGENT_TEMPLATE');
  }

  async send(role: Role, phone: string, code: string, _channel?: OtpChannel): Promise<void> {
    /*
     * E.164 WITH THE PLUS, straight from the port — this API's own examples read
     * `+919876543210`. Deliberately NOT the digit-stripping `WhatsAppOtpSender` does for
     * wabridge: the two gateways disagree, and copying that normalisation here would send a
     * number this one does not recognise.
     */
    const variables: Record<string, string> = { [this.config.codeVariable]: code };
    if (this.config.contactVariable !== undefined) {
      variables[this.config.contactVariable] = this.config.contactNumber;
    }
    // The code twice, on purpose where the template asks for it: the body renders it, the button
    // carries it. A button template with only the body filled is refused at 422, or worse,
    // accepted and delivered without a working button.
    if (this.config.buttonVariable !== undefined) variables[this.config.buttonVariable] = code;

    const payload = {
      messaging_product: 'whatsapp',
      phone_number_id: this.phoneNumberId,
      to: phone,
      type: 'template',
      template: {
        name: this.template,
        language: { code: this.config.languageCode },
        variables,
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      logger.error({ err: error, role }, 'waagent unreachable — login code not sent');
      throw AppError.internal(
        'INTERNAL',
        { reason: 'Could not reach the WhatsApp gateway' },
        error,
      );
    } finally {
      clearTimeout(timer);
    }

    // `null` rather than a thrown SyntaxError: a proxy's HTML 502 must still read as a rejection
    // with a status attached, not as an unhandled parse failure.
    const raw: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      logger.error(
        { role, status: response.status, gateway_response: raw, error_code: errorCodeOf(raw) },
        'waagent rejected the login code',
      );
      throw AppError.internal('INTERNAL', {
        reason: 'The WhatsApp gateway rejected the message',
        status: response.status,
      });
    }

    // `role` only — `phone` and `code` are on the logger's redaction list, which is right here.
    const messageId = messageIdOf(raw);
    logger.info({ role, message_id: messageId }, 'login code sent over WhatsApp');

    /*
     * ACCEPTED IS NOT DELIVERED, and this is the only place that still knows the id needed to
     * tell them apart. Guarded so a scheduling failure cannot turn a message that DID go out into
     * a 500 for the customer: the worst case without the check is a missing fallback, and the
     * "Get code by SMS" control on the OTP screen still covers that.
     */
    if (messageId !== null && this.config.onSent !== undefined) {
      try {
        this.config.onSent({ messageId, role, phone, code });
      } catch (error) {
        logger.warn({ err: error, role }, 'could not schedule the whatsapp delivery check');
      }
    }
  }
}

/**
 * The `wamid` the send returned, wherever this account's response shape puts it.
 *
 * Cloud-API-shaped responses carry `messages[0].id`; a thinner wrapper may answer a bare
 * `message_id`. Both are accepted, and `null` means the delivery check simply cannot run for
 * this send rather than that the send failed — the message may well have gone out.
 */
function messageIdOf(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const body = raw as { messages?: unknown; message_id?: unknown; id?: unknown };

  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const first = body.messages[0] as { id?: unknown };
    if (typeof first.id === 'string' && first.id !== '') return first.id;
  }
  if (typeof body.message_id === 'string' && body.message_id !== '') return body.message_id;
  if (typeof body.id === 'string' && body.id !== '') return body.id;
  return null;
}

/** `data.error.code`, for the log line. Best effort — the body may be anything on a failure. */
function errorCodeOf(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const err = (raw as { error?: { code?: unknown } }).error;
  return typeof err?.code === 'string' ? err.code : null;
}

/** Throws at construction, naming the variable, so a misconfigured prod deploy dies at boot. */
function demand(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw AppError.internal('INTERNAL', {
      reason: `WaAgentOtpSender needs ${name} — set it, or this process must not run in production`,
    });
  }
  return value;
}
