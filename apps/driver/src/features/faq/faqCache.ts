import { Directory, File, Paths } from 'expo-file-system';
import type { FaqDto } from '@driverzone/contracts';

/**
 * THE LAST FAQs THIS PHONE SAW, ON DISK.
 *
 * A driver opens this when a customer is disputing something — most often what the food and stay
 * on a long trip are supposed to come to, which the app quotes nowhere and settles in cash. That
 * conversation happens at the roadside, frequently well outside town, and answering it with a
 * retry button is no answer. So the last successful payload is written here and re-read on the
 * next open.
 *
 * It is the same file, written the same way, as the customer app's — deliberately, since the two
 * are reading the same list and must not be able to disagree about it.
 *
 * `Paths.cache`, not `Paths.document`: this is a copy of something the server owns, and the OS
 * reclaiming it under storage pressure costs nothing but a fetch. Nothing here is the source of
 * truth, and nothing is written that the customer typed.
 *
 * SYNCHRONOUS, on purpose. `textSync` and `write` are the file-system API's synchronous forms, and
 * the file is a few kilobytes of JSON — a screen that has to await a read before its first frame
 * flashes an empty state on every open, which is the exact flicker the cache exists to remove.
 *
 * EVERY OPERATION SWALLOWS ITS ERRORS. A cache is an optimisation: a full disk, a cleared cache
 * directory, or a file half-written when the app was killed must all mean "no cached copy", never
 * a crash on a help screen.
 */

const FILE_NAME = 'faqs.json';

/** Bumped when `FaqDto` changes shape, so an old build's file is ignored rather than misread. */
const VERSION = 1;

interface CachedPayload {
  version: number;
  savedAt: string;
  faqs: FaqDto[];
}

export interface CachedFaqs {
  faqs: FaqDto[];
  /** When this copy was fetched. The screen says so, rather than passing it off as current. */
  savedAt: Date;
}

function file(): File {
  return new File(Paths.cache, FILE_NAME);
}

export function readCachedFaqs(): CachedFaqs | null {
  try {
    const handle = file();
    if (!handle.exists) return null;

    const parsed = JSON.parse(handle.textSync()) as Partial<CachedPayload>;

    /*
     * Validated rather than trusted, because this file outlives the build that wrote it. A payload
     * from an older version, or one truncated by a kill mid-write, is discarded — showing a
     * customer a mangled answer about money is worse than showing them a spinner.
     */
    if (parsed.version !== VERSION || !Array.isArray(parsed.faqs) || typeof parsed.savedAt !== 'string') {
      return null;
    }

    const savedAt = new Date(parsed.savedAt);
    if (Number.isNaN(savedAt.getTime())) return null;

    return { faqs: parsed.faqs, savedAt };
  } catch {
    return null;
  }
}

export function writeCachedFaqs(faqs: readonly FaqDto[]): void {
  try {
    const payload: CachedPayload = {
      version: VERSION,
      savedAt: new Date().toISOString(),
      faqs: [...faqs],
    };

    // The cache directory exists on every platform the app runs on, but not necessarily this
    // subpath after the OS has reclaimed it — creating it idempotently is cheaper than finding out.
    const directory = new Directory(Paths.cache);
    if (!directory.exists) directory.create({ idempotent: true });

    file().write(JSON.stringify(payload), { encoding: 'utf8' });
  } catch {
    // Nothing to do and nothing to tell the customer: the screen they are on is already showing
    // the live answer. The next successful fetch tries again.
  }
}
