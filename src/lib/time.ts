export const DAY = 86_400_000;

const AVERAGE_MONTH = 30.436875 * DAY;

const MOST_LISTED = 1440;

// Preserve the service's timestamp precision when formatting requests.
export type TimePrecision = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond';

const PRECISIONS: readonly TimePrecision[] = ['year', 'month', 'day', 'hour', 'minute', 'second', 'millisecond'];

const WRITTEN_LENGTH: Record<TimePrecision, number> = { year: 4, month: 7, day: 10, hour: 13, minute: 16, second: 19, millisecond: 23 };

type ShownPrecision = 'year' | 'month' | 'day' | 'minute' | 'second';

// Use UTC for labels so the date never shifts with the reader's time zone.
const SHOWN_AS: Record<ShownPrecision | 'time' | 'time-with-seconds', Intl.DateTimeFormatOptions> = {
  'year': { year: 'numeric', timeZone: 'UTC' },
  'month': { year: 'numeric', month: 'long', timeZone: 'UTC' },
  'day': { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' },
  'minute': { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC', timeZoneName: 'short' },
  'second': { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'UTC', timeZoneName: 'short' },
  'time': { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' },
  'time-with-seconds': { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'UTC' },
};

const formatters = new Map<keyof typeof SHOWN_AS, Intl.DateTimeFormat>();

const formatter = (shown: keyof typeof SHOWN_AS): Intl.DateTimeFormat => {
  let format = formatters.get(shown);
  if (!format) formatters.set(shown, (format = new Intl.DateTimeFormat(undefined, SHOWN_AS[shown])));
  return format;
};

type Period = { months: number; ms: number };

type Extent = {
  start: number;
  // Include the stated endpoint even when it falls between regular periods.
  last: number;
  // No period means a single instant when the endpoints match, otherwise a continuous range.
  period?: Period;
  precision: TimePrecision;
  zoned: boolean;
};

type Written = { time: number; precision: TimePrecision; zoned: boolean };

const INSTANT = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2})(?::(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?)?)?$/i;

const DURATION = /^P(?=\d|T\d)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i;

const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;

const utc = (year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0, ms = 0): number => {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hours, minutes, seconds, ms);

  const named = date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day && date.getUTCHours() === hours && date.getUTCMinutes() === minutes;
  return named && date.getUTCSeconds() === seconds ? date.getTime() : NaN;
};

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

// Count calendar months from the original date to avoid drifting after shorter months.
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

const indexAtOrBefore = (extent: Extent, time: number): number => {
  const period = extent.period!;
  let index = Math.max(0, Math.floor((time - extent.start) / (period.months * AVERAGE_MONTH + period.ms)));
  while (index > 0 && timeAt(extent, index) > time) index--;
  while (timeAt(extent, index + 1) <= time) index++;
  return index;
};

const isContinuous = (extent: Extent): boolean => extent.period === undefined && extent.last > extent.start;

const latestIn = (extent: Extent, time: number): number => {
  if (time >= extent.last) return extent.last;
  if (!extent.period) return time;
  return timeAt(extent, indexAtOrBefore(extent, time));
};

const earliestAfter = (extent: Extent, time: number): number => {
  if (time < extent.start) return extent.start;
  if (!extent.period) return extent.last;
  return Math.min(timeAt(extent, indexAtOrBefore(extent, time) + 1), extent.last);
};

const isPresent = (text: string) => /^(present|now)$/i.test(text.trim());

const readExtent = (text: string, now: number): Extent | undefined => {
  const parts = text.trim().split('/');
  if (parts.length > 3) return undefined;

  const start = readInstant(parts[0]);
  if (!start) return undefined;

  const { precision, zoned } = start;
  if (parts.length === 1) return { start: start.time, last: start.time, precision, zoned };

  const present = isPresent(parts[1]);
  const end = present ? now : readInstant(parts[1])?.time;
  if (end === undefined) return undefined;

  const period = parts[2] ? readPeriod(parts[2]) : undefined;
  if (parts[2] && !period) return undefined;
  const stepped = period && (period.months > 0 || period.ms > 0) ? period : undefined;

  const extent: Extent = { start: start.time, last: Math.max(start.time, end), period: stepped, precision, zoned };

  if (present && stepped) extent.last = timeAt(extent, indexAtOrBefore(extent, extent.last));
  return extent;
};

const write = (time: number, { precision, zoned }: Extent): string => {
  const written = new Date(time).toISOString().slice(0, WRITTEN_LENGTH[precision]);
  return zoned && PRECISIONS.indexOf(precision) > PRECISIONS.indexOf('day') ? `${written}Z` : written;
};

const tellsTimeOfDay = (extent: Extent): boolean => {
  if (PRECISIONS.indexOf(extent.precision) <= PRECISIONS.indexOf('day')) return false;
  const midnights = extent.start % DAY === 0 && (!extent.period || extent.period.ms % DAY === 0);
  return !midnights;
};

export const parseTime = (text: string): number | undefined => readInstant(text)?.time;

export const startOfDay = (time: number): number => time - (((time % DAY) + DAY) % DAY);

export const dayValue = (time: number): string => new Date(time).toISOString().slice(0, 10);

export const parseDayValue = (value: string): number | undefined => (DATE_VALUE.test(value) ? readInstant(value)?.time : undefined);

export const describeDay = (day: number): string => formatter('day').format(day);

export default class TimeDomain {
  private readonly extents: readonly Extent[];

  // Prefix maximum endpoints let searches skip earlier runs even when their extents overlap.
  private readonly reach: readonly number[];

  private constructor(extents: Extent[]) {
    this.extents = [...extents].sort((a, b) => a.start - b.start);
    let reach = -Infinity;
    this.reach = this.extents.map(extent => (reach = Math.max(reach, extent.last)));
  }

  /** Parse instants, start/end/period runs, and comma lists; resolve "present" against now. */
  static parse(values: readonly string[], now: number = Date.now()): TimeDomain {
    const extents = values.flatMap(value => value.split(',')).map(text => readExtent(text, now));
    return new TimeDomain(extents.filter(extent => extent !== undefined));
  }

  get isEmpty(): boolean {
    return this.extents.length === 0;
  }

  get offersChoice(): boolean {
    return !this.isEmpty && this.first !== this.last;
  }

  get first(): number | undefined {
    return this.extents[0]?.start;
  }

  get last(): number | undefined {
    return this.reach[this.reach.length - 1];
  }

  get tellsTimeOfDay(): boolean {
    return this.extents.some(tellsTimeOfDay);
  }

  atOrBefore(time: number): number | undefined {
    return this.latestMatch(time)?.time;
  }

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

  next(time: number): number | undefined {
    let best: number | undefined;
    for (let index = this.firstReachingPast(time); index < this.extents.length; index++) {
      const extent = this.extents[index];
      if (best !== undefined && extent.start >= best) break;
      if (extent.last <= time) continue;
      const candidate = earliestAfter(extent, time);
      if (best === undefined || candidate < best) best = candidate;
    }
    return best;
  }

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

  /** Choose the nearest time on this UTC day, or the composite period that contains it. */
  forDay(day: number, timeOfDay = 0): number | undefined {
    const onDay = this.between(day, day + DAY);
    if (onDay.length > 0) {
      const wanted = day + timeOfDay;
      return onDay.reduce((best, time) => (Math.abs(time - wanted) < Math.abs(best - wanted) ? time : best));
    }

    const match = this.latestMatch(day);
    if (!match) return undefined;

    const { time, extent } = match;
    if (!extent.period) return time === day ? time : undefined;
    const ends = time < extent.last ? earliestAfter(extent, time) : addPeriod(time, extent.period, 1);
    return day < ends ? time : undefined;
  }

  format(time: number): string {
    const extent = this.latestMatch(time)?.extent ?? this.extents[0];
    return extent ? write(time, extent) : new Date(time).toISOString();
  }

  describe(time: number): string {
    return formatter(this.shownPrecision(time)).format(time);
  }

  describeTimeOfDay(time: number): string {
    return formatter(time % 60_000 === 0 ? 'time' : 'time-with-seconds').format(time);
  }

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
