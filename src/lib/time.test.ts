import { describe, it, expect } from '@stencil/vitest';

import TimeDomain, { DAY, dayValue, parseDayValue, parseTime, startOfDay } from './time';

const at = (text: string) => parseTime(text)!;

// MODIS true color as GIBS lists it, two of its gaps included
const MODIS = ['2000-02-24/2000-04-25/P1D', '2000-04-28/2000-08-06/P1D', '2025-11-10/2026-10-03/P1D'];

// GOES-East GeoColor, every ten minutes, with the lone frames and gaps a geostationary feed has
const GOES = ['2026-08-10T16:30:00Z/2026-08-10T16:30:00Z/PT10M', '2026-08-10T17:20:00Z/2026-08-10T17:30:00Z/PT10M', '2026-09-30T02:40:00Z/2026-10-02T23:30:00Z/PT10M'];

// TEMPO, whose scans are lone times, each with how long it stands for written after it
const TEMPO = ['2026-10-02T18:27:40Z/2026-10-02T18:27:40Z/PT59M41S', '2026-10-02T19:27:40Z/2026-10-02T19:27:40Z/PT59M41S', '2026-10-02T20:27:40Z/2026-10-02T20:27:40Z/PT59M41S'];

// MERRA2's monthly air temperature, which drops a run of lone days in among its months
const MERRA2 = ['1980-01-01/2023-11-01/P1M', '2025-06-04/2025-06-04/P1M', '2025-06-05/2025-06-05/P1M', '2025-07-01/2026-06-01/P1M'];

describe('parseTime', () => {
  it('reads a date as the start of that day in UTC', () => {
    expect(parseTime('2026-10-01')).toEqual(Date.UTC(2026, 9, 1));
  });

  it('reads a time with a zone, and one without as UTC', () => {
    expect(parseTime('2026-10-02T18:50:00Z')).toEqual(Date.UTC(2026, 9, 2, 18, 50));
    expect(parseTime('2026-10-02T18:50:00')).toEqual(Date.UTC(2026, 9, 2, 18, 50));
    expect(parseTime('2026-10-02T20:50:00+02:00')).toEqual(Date.UTC(2026, 9, 2, 18, 50));
  });

  it('reads a time written only to the year or month', () => {
    expect(parseTime('2016')).toEqual(Date.UTC(2016, 0, 1));
    expect(parseTime('2016-07')).toEqual(Date.UTC(2016, 6, 1));
  });

  it('reads milliseconds, the way GeoServer writes them', () => {
    expect(parseTime('2016-01-01T00:00:00.250Z')).toEqual(Date.UTC(2016, 0, 1, 0, 0, 0, 250));
  });

  it('refuses a day that does not exist, rather than rolling it into the next month', () => {
    expect(parseTime('2026-02-30')).toBeUndefined();
    expect(parseTime('2026-10-02T25:00:00Z')).toBeUndefined();
  });

  it('refuses what is not a time at all', () => {
    expect(parseTime('default')).toBeUndefined();
    expect(parseTime('')).toBeUndefined();
  });
});

describe('the day helpers', () => {
  it('finds the UTC day a time falls on', () => {
    expect(startOfDay(at('2026-10-02T18:50:00Z'))).toEqual(at('2026-10-02'));
    expect(dayValue(at('2026-10-02T23:59:59Z'))).toEqual('2026-10-02');
  });

  it('reads what a date input holds, and nothing it holds on the way to a date', () => {
    expect(parseDayValue('2021-02-20')).toEqual(at('2021-02-20'));
    expect(parseDayValue('')).toBeUndefined();
    expect(parseDayValue('2021-02')).toBeUndefined();
  });

  // Chrome passes through 0002, 0020 and 0201 while a year is typed digit by digit
  it('reads a year below 100 as itself, not one in the 1900s', () => {
    expect(new Date(parseDayValue('0020-10-01')!).getUTCFullYear()).toEqual(20);
  });
});

describe('TimeDomain', () => {
  describe('reading values', () => {
    it('spans every run it is given', () => {
      const domain = TimeDomain.parse(MODIS);

      expect(domain.first).toEqual(at('2000-02-24'));
      expect(domain.last).toEqual(at('2026-10-03'));
    });

    // What DescribeDomains returns: the whole domain in one string
    it('reads a comma-separated list as well as one value apiece', () => {
      expect(TimeDomain.parse([MODIS.join(',')]).last).toEqual(TimeDomain.parse(MODIS).last);
    });

    // GIBS ends AMSR2's 5-day snow water equivalent three days into a period, and serves that last day
    // by default
    it('ends a run at the end it was written with, even where the period does not land', () => {
      const domain = TimeDomain.parse(['2025-01-01/2025-09-01/P5D']);

      expect(domain.last).toEqual(at('2025-09-01'));
      expect(domain.previous(at('2025-09-01'))).toEqual(at('2025-08-29'));
      expect(domain.next(at('2025-08-29'))).toEqual(at('2025-09-01'));
    });

    it('leaves out values it cannot read, and keeps the rest', () => {
      const domain = TimeDomain.parse(['yesterday', '2026-09-01/2026-09-30/P1Q', '2026-09-01/2026-09-30/P1D']);

      expect(domain.first).toEqual(at('2026-09-01'));
      expect(domain.last).toEqual(at('2026-09-30'));
    });

    // GIBS's GRACE layer lists 2020-01-20/2020-01-10/P1M
    it('keeps the start of a run written backwards', () => {
      const domain = TimeDomain.parse(['2020-01-20/2020-01-10/P1M']);

      expect(domain.first).toEqual(at('2020-01-20'));
      expect(domain.last).toEqual(at('2020-01-20'));
    });

    it('ends a run written to "present" now', () => {
      const domain = TimeDomain.parse(['2026-09-01/present/P1D'], at('2026-10-02T12:00:00Z'));
      expect(domain.last).toEqual(at('2026-10-02'));
    });
  });

  describe('offering a choice', () => {
    it('offers one for a run of more than one time', () => {
      expect(TimeDomain.parse(MODIS).offersChoice).toBe(true);
    });

    // GEDI's biomass, a single four-year composite, as GIBS writes it
    it('offers none for a single time, however long it stands for', () => {
      expect(TimeDomain.parse(['2019-04-18/2019-04-18/P1429D']).offersChoice).toBe(false);
    });

    it('offers none for nothing', () => {
      const domain = TimeDomain.parse([]);
      expect(domain.isEmpty).toBe(true);
      expect(domain.offersChoice).toBe(false);
    });
  });

  describe('stepping', () => {
    it('steps a day at a time through a daily run', () => {
      const domain = TimeDomain.parse(MODIS);

      expect(domain.previous(at('2026-10-03'))).toEqual(at('2026-10-02'));
      expect(domain.next(at('2026-10-01'))).toEqual(at('2026-10-02'));
    });

    it('steps over a gap between runs', () => {
      const domain = TimeDomain.parse(MODIS);

      expect(domain.previous(at('2000-04-28'))).toEqual(at('2000-04-25'));
      expect(domain.next(at('2000-04-25'))).toEqual(at('2000-04-28'));
    });

    it('has nowhere to step before the first time or after the last', () => {
      const domain = TimeDomain.parse(MODIS);

      expect(domain.previous(at('2000-02-24'))).toBeUndefined();
      expect(domain.next(at('2026-10-03'))).toBeUndefined();
    });

    it('steps from a time between two of its own to the ones either side', () => {
      const domain = TimeDomain.parse(['2026-09-01/2026-09-30/P8D']);

      expect(domain.previous(at('2026-09-12'))).toEqual(at('2026-09-09'));
      expect(domain.next(at('2026-09-12'))).toEqual(at('2026-09-17'));
    });

    it('steps by calendar months, whatever their length', () => {
      const domain = TimeDomain.parse(['2024-01-01/2024-12-01/P1M']);

      expect(domain.next(at('2024-02-01'))).toEqual(at('2024-03-01'));
      expect(domain.previous(at('2024-03-01'))).toEqual(at('2024-02-01'));
    });

    // Counted from the start each time, so February's 29th doesn't become every later month's
    it('comes back to the 31st after a shorter month', () => {
      const domain = TimeDomain.parse(['2024-01-31/2024-05-31/P1M']);

      expect(domain.next(at('2024-01-31'))).toEqual(at('2024-02-29'));
      expect(domain.next(at('2024-02-29'))).toEqual(at('2024-03-31'));
    });

    it('steps ten minutes at a time through a sub-daily run, and across its gaps', () => {
      const domain = TimeDomain.parse(GOES);

      expect(domain.previous(at('2026-10-02T23:30:00Z'))).toEqual(at('2026-10-02T23:20:00Z'));
      expect(domain.previous(at('2026-09-30T02:40:00Z'))).toEqual(at('2026-08-10T17:30:00Z'));
      expect(domain.previous(at('2026-08-10T17:20:00Z'))).toEqual(at('2026-08-10T16:30:00Z'));
    });

    it('steps between lone times', () => {
      const domain = TimeDomain.parse(TEMPO);

      expect(domain.previous(at('2026-10-02T20:27:40Z'))).toEqual(at('2026-10-02T19:27:40Z'));
      expect(domain.next(at('2026-10-02T18:27:40Z'))).toEqual(at('2026-10-02T19:27:40Z'));
    });

    // GRACE lists 2019-03-01/2022-12-01/P1M and then 2020-02-01/2022-07-01/P1M, inside it
    it('finds the nearest time across runs that overlap', () => {
      const domain = TimeDomain.parse(['2019-03-01/2022-12-01/P1M', '2020-01-20/2020-01-10/P1M', '2020-02-01/2022-07-01/P1M']);

      expect(domain.previous(at('2022-10-01'))).toEqual(at('2022-09-01'));
      expect(domain.next(at('2020-01-01'))).toEqual(at('2020-01-20'));
      expect(domain.next(at('2020-01-20'))).toEqual(at('2020-02-01'));
      expect(domain.last).toEqual(at('2022-12-01'));
    });

    // Any time between the ends can be asked for, so there is no next one to step to
    it('steps to the ends of a continuous range', () => {
      const domain = TimeDomain.parse(['2026-01-01/2026-12-31']);

      expect(domain.previous(at('2026-06-15'))).toEqual(at('2026-01-01'));
      expect(domain.next(at('2026-06-15'))).toEqual(at('2026-12-31'));
      expect(domain.atOrBefore(at('2026-06-15'))).toEqual(at('2026-06-15'));
    });
  });

  describe('a day picked from a calendar', () => {
    it('gets that day, from a daily layer', () => {
      expect(TimeDomain.parse(MODIS).forDay(at('2026-03-01'))).toEqual(at('2026-03-01'));
    });

    it('gets nothing for a day in a gap', () => {
      expect(TimeDomain.parse(MODIS).forDay(at('2000-04-26'))).toBeUndefined();
    });

    it('gets nothing for a day before the first or after the last', () => {
      const domain = TimeDomain.parse(MODIS);

      expect(domain.forDay(at('1999-12-31'))).toBeUndefined();
      expect(domain.forDay(at('2026-10-04'))).toBeUndefined();
    });

    it('gets the composite whose period takes the day in', () => {
      const domain = TimeDomain.parse(['2026-09-01/2026-09-17/P8D']);

      expect(domain.forDay(at('2026-09-12'))).toEqual(at('2026-09-09'));
      // The last composite still stands for the eight days it started
      expect(domain.forDay(at('2026-09-24'))).toEqual(at('2026-09-17'));
      expect(domain.forDay(at('2026-09-25'))).toBeUndefined();
    });

    // The last of AMSR2's 5-day composites starts three days after the one before it
    it('gets a composite that runs short only for the days it covers', () => {
      const domain = TimeDomain.parse(['2025-01-01/2025-09-01/P5D']);

      expect(domain.forDay(at('2025-08-31'))).toEqual(at('2025-08-29'));
      expect(domain.forDay(at('2025-09-03'))).toEqual(at('2025-09-01'));
    });

    it('gets the month a day is in, from a monthly layer', () => {
      expect(TimeDomain.parse(MERRA2).forDay(at('2023-08-15'))).toEqual(at('2023-08-01'));
    });

    it('gets the lone day itself when a monthly layer lists one', () => {
      expect(TimeDomain.parse(MERRA2).forDay(at('2025-06-04'))).toEqual(at('2025-06-04'));
    });

    it('keeps to the hour it was at, on a day with many times', () => {
      const domain = TimeDomain.parse(GOES);
      const timeOfDay = at('2026-10-02T18:50:00Z') - at('2026-10-02');

      expect(domain.forDay(at('2026-10-01'), timeOfDay)).toEqual(at('2026-10-01T18:50:00Z'));
    });

    it('takes the time nearest the hour it was at, when that hour has none', () => {
      const domain = TimeDomain.parse(GOES);
      const timeOfDay = at('2026-10-02T18:50:00Z') - at('2026-10-02');

      expect(domain.forDay(at('2026-08-10'), timeOfDay)).toEqual(at('2026-08-10T17:30:00Z'));
    });

    it('gets nothing for a day without one of a sub-daily layer’s times', () => {
      expect(TimeDomain.parse(GOES).forDay(at('2026-09-01'))).toBeUndefined();
    });
  });

  describe('one day’s times', () => {
    it('lists every one of them, earliest first', () => {
      const times = TimeDomain.parse(GOES).between(at('2026-10-02'), at('2026-10-02') + DAY);

      // Six an hour, and the last of them twenty minutes short of midnight
      expect(times).toHaveLength(6 * 24 - 2);
      expect(times[0]).toEqual(at('2026-10-02T00:00:00Z'));
      expect(times.at(-1)).toEqual(at('2026-10-02T23:30:00Z'));
    });

    it('lists lone times', () => {
      expect(TimeDomain.parse(TEMPO).between(at('2026-10-02'), at('2026-10-03'))).toEqual(TEMPO.map(value => at(value.split('/')[0])));
    });

    it('lists each time once, when runs overlap', () => {
      const domain = TimeDomain.parse(['2026-10-02T00:00:00Z/2026-10-02T01:00:00Z/PT30M', '2026-10-02T00:30:00Z/2026-10-02T00:30:00Z/PT30M']);
      expect(domain.between(at('2026-10-02'), at('2026-10-03'))).toHaveLength(3);
    });
  });

  describe('writing a time back for the service', () => {
    it('writes a daily layer’s times as dates', () => {
      const domain = TimeDomain.parse(MODIS);
      expect(domain.format(at('2026-09-30'))).toEqual('2026-09-30');
    });

    it('writes a sub-daily layer’s times whole, with their zone', () => {
      const domain = TimeDomain.parse(GOES);
      expect(domain.format(at('2026-10-02T18:50:00Z'))).toEqual('2026-10-02T18:50:00Z');
    });

    it('writes each time the way its own run is written', () => {
      const domain = TimeDomain.parse(['2016-01-01T00:00:00.000Z/2016-12-31T00:00:00.000Z/P1D', '2017-01-01/2017-12-31/P1D']);

      expect(domain.format(at('2016-03-01'))).toEqual('2016-03-01T00:00:00.000Z');
      expect(domain.format(at('2017-03-01'))).toEqual('2017-03-01');
    });

    it('leaves off a zone the service never wrote', () => {
      const domain = TimeDomain.parse(['2026-10-02T00:00:00/2026-10-02T12:00:00/PT1H']);
      expect(domain.format(at('2026-10-02T06:00:00Z'))).toEqual('2026-10-02T06:00:00');
    });
  });

  describe('telling a time to people', () => {
    it('tells a daily layer’s times by the date, in UTC', () => {
      expect(TimeDomain.parse(MODIS).describe(at('2026-10-01'))).toEqual('Oct 1, 2026');
    });

    it('tells a monthly layer’s times by the month', () => {
      expect(TimeDomain.parse(MERRA2).describe(at('2026-06-01'))).toEqual('June 2026');
    });

    // A lone day dropped into a monthly layer would otherwise read as the month it's in, the same as
    // the month itself and the other lone days around it
    it('tells a lone day in a monthly layer by its date', () => {
      expect(TimeDomain.parse(MERRA2).describe(at('2025-06-04'))).toEqual('Jun 4, 2025');
    });

    // VIIRS Black Marble, as GIBS lists it
    it('tells a yearly layer’s times by the year', () => {
      expect(TimeDomain.parse(['2012-01-01/2012-01-01/P1Y', '2016-01-01/2016-01-01/P1Y']).describe(at('2016-01-01'))).toEqual('2016');
    });

    it('tells a sub-daily layer’s times to the minute, saying they are UTC', () => {
      expect(TimeDomain.parse(GOES).describe(at('2026-10-02T18:50:00Z'))).toEqual('Oct 2, 2026, 18:50 UTC');
    });

    it('tells the seconds when a time has some', () => {
      expect(TimeDomain.parse(TEMPO).describe(at('2026-10-02T20:27:40Z'))).toEqual('Oct 2, 2026, 20:27:40 UTC');
    });

    it('tells a time of day on its own', () => {
      const domain = TimeDomain.parse(TEMPO);

      expect(domain.describeTimeOfDay(at('2026-10-02T20:27:40Z'))).toEqual('20:27:40');
      expect(TimeDomain.parse(GOES).describeTimeOfDay(at('2026-10-02T08:50:00Z'))).toEqual('08:50');
    });

    // GeoServer writes a daily layer's times out to the millisecond, all of them at midnight
    it('tells times that all fall at midnight by the date alone', () => {
      const domain = TimeDomain.parse(['2016-01-01T00:00:00.000Z/2016-12-31T00:00:00.000Z/P1D']);

      expect(domain.tellsTimeOfDay).toBe(false);
      expect(domain.describe(at('2016-03-01'))).toEqual('Mar 1, 2016');
    });

    it('knows which layers are told by the time of day', () => {
      expect(TimeDomain.parse(GOES).tellsTimeOfDay).toBe(true);
      expect(TimeDomain.parse(TEMPO).tellsTimeOfDay).toBe(true);
      expect(TimeDomain.parse(MODIS).tellsTimeOfDay).toBe(false);
    });
  });
});
