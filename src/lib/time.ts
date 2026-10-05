/**
 * The times a layer can be drawn at, read from the values a service lists for its Time dimension.
 *
 * WMTS writes these the way WMS does (OGC 06-042, annex C): each value is a single ISO 8601 time, a
 * start/end/period run of them, or a comma-separated list of either. NASA GIBS is what this was written
 * against, and between its layers it uses every shape there is - daily runs with gaps between them,
 * monthly and yearly ones, runs every ten minutes, and lone times with a period written after them that
 * says how long each one stands for - so nothing here assumes one cadence, one precision, or even that
 * the runs arrive sorted and apart: GIBS's own GRACE layer lists one run of months inside another.
 *
 * Every time is a number of milliseconds since the epoch, in UTC. A time written without a zone is read
 * as UTC too, which is what services mean by one, rather than in whatever zone the reader's browser
 * happens to be in - the same day has to mean the same day to everyone looking at it.
 */

// A day in milliseconds. UTC has no daylight saving, so every one of its days is this long.
export const DAY = 86_400_000;

// The Gregorian calendar's average month, for estimating how many months a span holds before they're
// counted exactly
const AVERAGE_MONTH = 30.436875 * DAY;

// The most times listed for one day. A day's choices go into a <select>, and a run with a period of a
// second would otherwise put 86,400 of them there; the cadences services actually publish are minutes
// apart at the finest (GIBS's is six), which a day of this many holds every one of.
const MOST_LISTED = 1440;

// How finely a time was written down, coarsest first. ISO 8601 lets a writer stop at any of these, and
// what a service writes is what it expects back: a daily layer answers to 2026-10-01, while GIBS's
// sub-daily ones want the whole of 2026-10-02T18:50:00Z.
export type TimePrecision = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond';

const PRECISIONS: readonly TimePrecision[] = ['year', 'month', 'day', 'hour', 'minute', 'second', 'millisecond'];

// How much of an ISO string each precision keeps
const WRITTEN_LENGTH: Record<TimePrecision, number> = { year: 4, month: 7, day: 10, hour: 13, minute: 16, second: 19, millisecond: 23 };

// How finely a time is told to people, which is coarser than it's written whenever the run it belongs to
// is: a monthly layer's 2026-06-01 is June 2026, not the first of the month
type ShownPrecision = 'year' | 'month' | 'day' | 'minute' | 'second';

// All of them in UTC, for the same reason everything here is: the 1st of October is the 30th of
// September in California, and a picture taken on one isn't of the other. Times say so, since a time
// of day without a zone reads as the reader's own.
const SHOWN_AS: Record<ShownPrecision | 'time' | 'time-with-seconds', Intl.DateTimeFormatOptions> = {
  'year': { year: 'numeric', timeZone: 'UTC' },
  'month': { year: 'numeric', month: 'long', timeZone: 'UTC' },
  'day': { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' },
  'minute': { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC', timeZoneName: 'short' },
  'second': { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'UTC', timeZoneName: 'short' },
  // The time of day alone, for a list of one day's times, where the zone is said once beside the list
  'time': { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' },
  'time-with-seconds': { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'UTC' },
};

// Built once each and kept: a day of GOES-East is 144 times to label, and a formatter is far dearer to
// make than to use
const formatters = new Map<keyof typeof SHOWN_AS, Intl.DateTimeFormat>();

const formatter = (shown: keyof typeof SHOWN_AS): Intl.DateTimeFormat => {
  let format = formatters.get(shown);
  if (!format) formatters.set(shown, (format = new Intl.DateTimeFormat(undefined, SHOWN_AS[shown])));
  return format;
};

// An ISO 8601 duration, in the two parts that add differently: whole months, whose length depends on
// where they start, and a fixed number of milliseconds for the rest. A year is twelve months, a week
// seven days.
type Period = { months: number; ms: number };

// One run of times a dimension lists: start, start + period, and so on up to the end it was written with
type Extent = {
  start: number;
  // The end it was written with, which is one of its times even when the period doesn't land on it.
  // GIBS ends AMSR2's 5-day snow water equivalent at 2025-01-01/2025-09-01/P5D, three days into a period,
  // and serves that last day by default - the last period of a run can be a short one.
  last: number;
  // Undefined for a value written without one. That is a single time when start and last agree, and
  // otherwise a continuous range, where any time between the two can be asked for (WMS also reads a
  // period of zero that way). A single time can still carry one - TEMPO's 2026-09-25T23:51:39Z/
  // 2026-09-25T23:51:39Z/PT39M49S - and then it's how long that time stands for.
  period?: Period;
  // How the run's times are written, so that a time chosen from it is written back the way the service
  // wrote it - which is the way it will understand
  precision: TimePrecision;
  zoned: boolean;
};

// A time as written: when it is, and how it was put
type Written = { time: number; precision: TimePrecision; zoned: boolean };

const INSTANT = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2})(?::(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?)?)?$/i;

const DURATION = /^P(?=\d|T\d)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i;

const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;

// A time in UTC from its parts, or NaN when they don't name one: the 30th of February, the 25th hour.
// Built with setUTCFullYear rather than Date.UTC, which reads a year below 100 as one in the 1900s.
const utc = (year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0, ms = 0): number => {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hours, minutes, seconds, ms);

  const named = date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day && date.getUTCHours() === hours && date.getUTCMinutes() === minutes;
  return named && date.getUTCSeconds() === seconds ? date.getTime() : NaN;
};

// How far ahead of UTC a written zone is, in milliseconds
const zoneOffset = (zone: string | undefined): number => {
  const match = zone ? /^([+-])(\d{2}):?(\d{2})?$/.exec(zone) : null;
  if (!match) return 0;
  const [, sign, hours, minutes = '0'] = match;
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) * 60_000;
};

const readInstant = (text: string): Written | undefined => {
  const match = INSTANT.exec(text.trim());
  if (!match) return undefined;

  const [, year, month, day, hours, minutes, seconds, fraction, zone] = match;
  const parts = [month, day, hours, minutes, seconds, fraction];
  // The first part left out says how far the writer went; one written to the second has every part
  // up to the fraction
  const missing = parts.findIndex(part => part === undefined);
  const precision = PRECISIONS[missing === -1 ? PRECISIONS.length - 1 : missing];

  const ms = fraction ? Number(fraction.slice(0, 3).padEnd(3, '0')) : 0;
  const time = utc(Number(year), Number(month ?? 1) - 1, Number(day ?? 1), Number(hours ?? 0), Number(minutes ?? 0), Number(seconds ?? 0), ms);
  if (Number.isNaN(time)) return undefined;

  return { time: time - zoneOffset(zone), precision, zoned: zone !== undefined };
};

const readPeriod = (text: string): Period | undefined => {
  const match = DURATION.exec(text.trim());
  if (!match) return undefined;

  const [years, months, weeks, days, hours, minutes] = match.slice(1, 7).map(part => Number(part ?? 0));
  const seconds = Number((match[7] ?? '0').replace(',', '.'));
  return { months: years * 12 + months, ms: (weeks * 7 + days) * DAY + hours * 3_600_000 + minutes * 60_000 + Math.round(seconds * 1000) };
};

const daysInMonth = (year: number, month: number): number => {
  const date = new Date(0);
  date.setUTCFullYear(year, month + 1, 0);
  return date.getUTCDate();
};

// A time moved on by a whole number of periods. Months are counted on the calendar, from the time
// itself rather than from one step to the next, so a run starting on the 31st comes back to the 31st
// after a shorter month instead of drifting onto the 28th for good.
const addPeriod = (time: number, { months, ms }: Period, count: number): number => {
  if (!months) return time + ms * count;

  const date = new Date(time);
  const total = date.getUTCMonth() + months * count;
  const year = date.getUTCFullYear() + Math.floor(total / 12);
  const month = total - Math.floor(total / 12) * 12;
  date.setUTCFullYear(year, month, Math.min(date.getUTCDate(), daysInMonth(year, month)));
  return date.getTime() + ms * count;
};

const timeAt = (extent: Extent, index: number): number => addPeriod(extent.start, extent.period!, index);

// How many periods into its run the latest of the times the period lands on is, at or before this one -
// for a time at or after the run's start. Estimated from the period's average length and then put right,
// since months aren't all one length.
const indexAtOrBefore = (extent: Extent, time: number): number => {
  const period = extent.period!;
  let index = Math.max(0, Math.floor((time - extent.start) / (period.months * AVERAGE_MONTH + period.ms)));
  while (index > 0 && timeAt(extent, index) > time) index--;
  while (timeAt(extent, index + 1) <= time) index++;
  return index;
};

const isContinuous = (extent: Extent): boolean => extent.period === undefined && extent.last > extent.start;

// The latest of a run's times at or before this one, for a time at or after the run's start. Only a
// continuous range gets as far as the second test - a single time's start is its last - and that holds
// the time itself.
const latestIn = (extent: Extent, time: number): number => {
  if (time >= extent.last) return extent.last;
  if (!extent.period) return time;
  return timeAt(extent, indexAtOrBefore(extent, time));
};

// The earliest of a run's times after this one, for a run that goes on past it. A continuous range has
// no next time of its own to step to, so stepping goes to its end.
const earliestAfter = (extent: Extent, time: number): number => {
  if (time < extent.start) return extent.start;
  if (!extent.period) return extent.last;
  return Math.min(timeAt(extent, indexAtOrBefore(extent, time) + 1), extent.last);
};

const isPresent = (text: string) => /^(present|now)$/i.test(text.trim());

// One value of a dimension: a time, or a run of them
const readExtent = (text: string, now: number): Extent | undefined => {
  const parts = text.trim().split('/');
  if (parts.length > 3) return undefined;

  const start = readInstant(parts[0]);
  if (!start) return undefined;

  const { precision, zoned } = start;
  if (parts.length === 1) return { start: start.time, last: start.time, precision, zoned };

  // WMS lets a run end at "present", which a service that keeps a layer up to date might write
  const present = isPresent(parts[1]);
  const end = present ? now : readInstant(parts[1])?.time;
  if (end === undefined) return undefined;

  // A period we can't read leaves no way to know which times the run holds, so the run is left out
  // rather than guessed at. One of zero is WMS's way of saying the range is continuous.
  const period = parts[2] ? readPeriod(parts[2]) : undefined;
  if (parts[2] && !period) return undefined;
  const stepped = period && (period.months > 0 || period.ms > 0) ? period : undefined;

  // A run written backwards - GIBS has one, 2020-01-20/2020-01-10/P1M - still names its start, which
  // is the one time in it the service has said it has
  const extent: Extent = { start: start.time, last: Math.max(start.time, end), period: stepped, precision, zoned };

  // Unlike an end that's written down, "present" is only how far the run has got, not one of its times:
  // it ends at the last one the period lands on
  if (present && stepped) extent.last = timeAt(extent, indexAtOrBefore(extent, extent.last));
  return extent;
};

// A time written the way a run writes its own
const write = (time: number, { precision, zoned }: Extent): string => {
  const written = new Date(time).toISOString().slice(0, WRITTEN_LENGTH[precision]);
  return zoned && PRECISIONS.indexOf(precision) > PRECISIONS.indexOf('day') ? `${written}Z` : written;
};

// Whether a run's times are told by the time of day. Written down to one, unless every one of them falls
// at midnight anyway - a daily layer that writes 2016-01-01T00:00:00.000Z, as GeoServer does - in which
// case the day is all there is to say.
const tellsTimeOfDay = (extent: Extent): boolean => {
  if (PRECISIONS.indexOf(extent.precision) <= PRECISIONS.indexOf('day')) return false;
  const midnights = extent.start % DAY === 0 && (!extent.period || extent.period.ms % DAY === 0);
  return !midnights;
};

/** One ISO 8601 time, as milliseconds since the epoch; undefined for anything that isn't one. */
export const parseTime = (text: string): number | undefined => readInstant(text)?.time;

/** The start of the UTC day a time falls on. */
export const startOfDay = (time: number): number => time - (((time % DAY) + DAY) % DAY);

/** The UTC day a time falls on, the way a date input writes its value: 2026-10-01. */
export const dayValue = (time: number): string => new Date(time).toISOString().slice(0, 10);

/** The UTC day a date input's value names, or undefined while it doesn't name one. */
export const parseDayValue = (value: string): number | undefined => (DATE_VALUE.test(value) ? readInstant(value)?.time : undefined);

/** A UTC day told to people, whatever a layer's own times are told by: Feb 20, 2021. */
export const describeDay = (day: number): string => formatter('day').format(day);

export default class TimeDomain {
  // Sorted by start
  private readonly extents: readonly Extent[];

  // reach[i] is the latest time any of extents[0..i] holds. The runs are sorted by start, but a service
  // can list one inside another, so a later start doesn't promise that an earlier run is over - this is
  // what lets a search stop early anyway, once nothing behind it could reach past what it has found.
  private readonly reach: readonly number[];

  private constructor(extents: Extent[]) {
    this.extents = [...extents].sort((a, b) => a.start - b.start);
    let reach = -Infinity;
    this.reach = this.extents.map(extent => (reach = Math.max(reach, extent.last)));
  }

  /**
   * Read the values a dimension lists. Each can be a time, a run, or a comma-separated list of either -
   * DescribeDomains puts a whole domain in one string. Anything that isn't one of those is left out.
   * `now` is what a run ending at "present" ends at.
   */
  static parse(values: readonly string[], now: number = Date.now()): TimeDomain {
    const extents = values.flatMap(value => value.split(',')).map(text => readExtent(text, now));
    return new TimeDomain(extents.filter(extent => extent !== undefined));
  }

  get isEmpty(): boolean {
    return this.extents.length === 0;
  }

  /** Whether there's more than one time to choose between. A layer published for one time has nothing for a control to do. */
  get offersChoice(): boolean {
    return !this.isEmpty && this.first !== this.last;
  }

  get first(): number | undefined {
    return this.extents[0]?.start;
  }

  get last(): number | undefined {
    return this.reach[this.reach.length - 1];
  }

  /** Whether any of these times is told by its time of day, rather than by its date alone. */
  get tellsTimeOfDay(): boolean {
    return this.extents.some(tellsTimeOfDay);
  }

  /** The latest time at or before this one. */
  atOrBefore(time: number): number | undefined {
    return this.latestMatch(time)?.time;
  }

  /** The latest time before this one. A continuous range offers only its two ends to step to. */
  previous(time: number): number | undefined {
    let best: number | undefined;
    for (let index = this.lastStartingBy(time - 1); index >= 0; index--) {
      if (best !== undefined && this.reach[index] <= best) break;
      const extent = this.extents[index];
      const candidate = isContinuous(extent) ? (extent.last < time ? extent.last : extent.start) : latestIn(extent, time - 1);
      if (best === undefined || candidate > best) best = candidate;
    }
    return best;
  }

  /** The earliest time after this one. */
  next(time: number): number | undefined {
    let best: number | undefined;
    for (let index = this.firstReachingPast(time); index < this.extents.length; index++) {
      const extent = this.extents[index];
      // This run and every one after it starts no earlier than what's already been found
      if (best !== undefined && extent.start >= best) break;
      if (extent.last <= time) continue;
      const candidate = earliestAfter(extent, time);
      if (best === undefined || candidate < best) best = candidate;
    }
    return best;
  }

  /** Every time from `from` up to but not including `to`, earliest first - one day's worth, say. */
  between(from: number, to: number): number[] {
    const times = new Set<number>();

    for (let index = this.firstReachingPast(from - 1); index < this.extents.length && this.extents[index].start < to; index++) {
      const extent = this.extents[index];
      if (extent.last < from) continue;

      if (!extent.period) {
        [extent.start, extent.last].filter(time => time >= from && time < to).forEach(time => times.add(time));
        continue;
      }

      let step = extent.start >= from ? 0 : indexAtOrBefore(extent, from - 1) + 1;
      for (let time = timeAt(extent, step); time < extent.last && time < to && times.size < MOST_LISTED; time = timeAt(extent, ++step)) {
        times.add(time);
      }
      if (extent.last < to) times.add(extent.last);
    }

    return [...times].sort((a, b) => a - b).slice(0, MOST_LISTED);
  }

  /**
   * The time to show for a UTC day a reader picked, or undefined if there's nothing for it.
   *
   * A time on the day itself if there is one - the one nearest `timeOfDay`, for a layer with several a
   * day, so that moving to another day keeps to the same hour. Otherwise the time whose period takes the
   * day in: the 8-day composite that started on the 22nd, for the 25th, or the month the 15th is in.
   * A day in a gap between runs belongs to no period, and gets nothing.
   */
  forDay(day: number, timeOfDay = 0): number | undefined {
    const onDay = this.between(day, day + DAY);
    if (onDay.length > 0) {
      const wanted = day + timeOfDay;
      return onDay.reduce((best, time) => (Math.abs(time - wanted) < Math.abs(best - wanted) ? time : best));
    }

    const match = this.latestMatch(day);
    if (!match) return undefined;

    // A time stands until the next one in its run, or for a whole period if it's the run's last
    const { time, extent } = match;
    if (!extent.period) return time === day ? time : undefined;
    const ends = time < extent.last ? earliestAfter(extent, time) : addPeriod(time, extent.period, 1);
    return day < ends ? time : undefined;
  }

  /** A time written the way the service writes the run it belongs to. */
  format(time: number): string {
    const extent = this.latestMatch(time)?.extent ?? this.extents[0];
    return extent ? write(time, extent) : new Date(time).toISOString();
  }

  /** A time told to people - Oct 1, 2026; June 2026; Oct 2, 2026, 18:50 UTC - in the reader's own locale. */
  describe(time: number): string {
    return formatter(this.shownPrecision(time)).format(time);
  }

  /** Just the time of day, in UTC, for a list of one day's times: 18:50, or 20:27:40 for one with seconds. */
  describeTimeOfDay(time: number): string {
    return formatter(time % 60_000 === 0 ? 'time' : 'time-with-seconds').format(time);
  }

  // How finely a time is worth telling. To the minute for a run told by its time of day, or the second if
  // it has some. Otherwise as finely as the run itself goes: the year of a yearly layer, the month of a
  // monthly one - but only for a time that starts one, since a service can drop a lone day into a
  // monthly layer (GIBS's MERRA2 has two months of them) and that day has to read as itself.
  private shownPrecision(time: number): ShownPrecision {
    const extent = this.latestMatch(time)?.extent ?? this.extents[0];
    if (!extent) return 'second';
    if (tellsTimeOfDay(extent)) return time % 60_000 === 0 ? 'minute' : 'second';
    if (extent.precision === 'year' || extent.precision === 'month') return extent.precision;

    const date = new Date(time);
    const monthly = extent.period !== undefined && extent.period.ms === 0 && extent.period.months > 0;
    if (monthly && date.getUTCDate() === 1 && time % DAY === 0) {
      return extent.period!.months % 12 === 0 && date.getUTCMonth() === 0 ? 'year' : 'month';
    }
    return 'day';
  }

  // The latest time at or before this one, and the run it came from
  private latestMatch(time: number): { time: number; extent: Extent } | undefined {
    let best: { time: number; extent: Extent } | undefined;
    for (let index = this.lastStartingBy(time); index >= 0; index--) {
      if (best && this.reach[index] <= best.time) break;
      const extent = this.extents[index];
      const candidate = latestIn(extent, time);
      if (!best || candidate > best.time) best = { time: candidate, extent };
    }
    return best;
  }

  // The last run to start at or before this time, or -1 if none has
  private lastStartingBy(time: number): number {
    let low = 0;
    let high = this.extents.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.extents[middle].start <= time) low = middle + 1;
      else high = middle;
    }
    return low - 1;
  }

  // The first run that, with everything before it, reaches past this time
  private firstReachingPast(time: number): number {
    let low = 0;
    let high = this.reach.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.reach[middle] <= time) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}
