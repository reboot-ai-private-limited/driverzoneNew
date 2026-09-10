import type { ReplaceFaqsRequest } from '@driverzone/contracts';
import type { ReplaceFaqsInput } from './faq.validation.js';

/**
 * Compile-only drift guard between the Zod schema and the shared wire type.
 *
 * See `zones/interface/zones.typecheck.ts` for the full rationale — same mechanism, this module's
 * shape. Imported by nothing, emits nothing; exists so `tsc --noEmit` fails when
 * `faq.validation.ts` and `@driverzone/contracts` disagree about the request body.
 *
 * Only the request is guarded. Responses are built through `toFaqDto`, whose return type is the
 * imported `FaqDto`, so TypeScript already checks those where they are assembled.
 */

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;

export type ReplaceFaqsMatches = AssertTrue<Exact<ReplaceFaqsInput, ReplaceFaqsRequest>>;
