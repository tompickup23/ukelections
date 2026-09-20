export interface JourneyLink {
  href: string;
  label: string;
  description: string;
  trackingId?: string;
}

export interface ParliamentaryJourneyRecord {
  slug: string;
  name: string;
  country?: string | null;
  region?: string | null;
  majority_pct?: number | null;
}

export interface LocalContestJourneyRecord {
  slug: string;
  status?: string | null;
  contest: {
    polling_day: string;
    council_slug?: string | null;
    council_name: string;
    ward_name: string;
  };
  result?: { declared?: boolean } | null;
}

const fragment = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const addUnique = (links: JourneyLink[], link: JourneyLink, selfHref?: string) => {
  if (link.href === selfHref || links.some((existing) => existing.href === link.href)) return;
  links.push(link);
};

const localHref = (contest: LocalContestJourneyRecord) =>
  `/by-elections/local/${contest.slug}/`;

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

export function buildParliamentaryJourneyLinks(
  current: ParliamentaryJourneyRecord,
  records: ParliamentaryJourneyRecord[],
): JourneyLink[] {
  const links: JourneyLink[] = [];
  const selfHref = `/seats/parliament/${current.slug}/`;
  addUnique(links, {
    href: "/forecasts/general-election/",
    label: "National general election forecast",
    description: "See the projected House of Commons and all 650 seat calls.",
    trackingId: "seat-to-ge-forecast",
  }, selfHref);
  addUnique(links, {
    href: "/polling/",
    label: "Latest Westminster polling",
    description: "Read the named polls and national averages behind this forecast.",
    trackingId: "seat-to-polling",
  }, selfHref);
  addUnique(links, {
    href: "/methodology/general-election/",
    label: "How the model works",
    description: "Review the general election method, assumptions and limitations.",
    trackingId: "seat-to-methodology",
  }, selfHref);

  const country = current.country || "uk";
  const region = current.region || country;
  addUnique(links, {
    href: `/seats/parliament/#region-${fragment(country)}-${fragment(region)}`,
    label: `Browse ${String(region).replace(/_/g, " ")} constituencies`,
    description: "Compare this seat with the other constituencies in its region.",
    trackingId: "seat-to-region",
  }, selfHref);

  // A close-contest recommendation is shown only when this seat is itself
  // marginal. That keeps the block useful without turning safe seats into an
  // arbitrary party- or ideology-based recommendation surface.
  if (typeof current.majority_pct === "number" && Math.abs(current.majority_pct) <= 0.05) {
    const nearbyMarginals = records
      .filter(
        (record) =>
          record.slug !== current.slug &&
          record.region === current.region &&
          typeof record.majority_pct === "number" &&
          Math.abs(record.majority_pct) <= 0.05,
      )
      .sort(
        (a, b) =>
          Math.abs(a.majority_pct || 0) - Math.abs(b.majority_pct || 0) ||
          a.name.localeCompare(b.name, "en-GB"),
      )
      .slice(0, 2);
    for (const record of nearbyMarginals) {
      addUnique(links, {
        href: `/seats/parliament/${record.slug}/`,
        label: record.name,
        description: "Another forecast within five percentage points in this region.",
        trackingId: "seat-to-regional-marginal",
      }, selfHref);
    }
  }

  return links.slice(0, 6);
}

export function buildLocalContestJourneyLinks(
  current: LocalContestJourneyRecord,
  contests: LocalContestJourneyRecord[],
  today: string,
  wardHref?: string | null,
): JourneyLink[] {
  const links: JourneyLink[] = [];
  const selfHref = localHref(current);
  const others = contests.filter((contest) => contest.slug !== current.slug);
  const currentIsUpcoming = current.contest.polling_day >= today;

  if (currentIsUpcoming && wardHref) {
    addUnique(links, {
      href: wardHref,
      label: `${current.contest.ward_name} ward page`,
      description: "See the ward's May 2026 forecast, result and model record.",
      trackingId: "byelection-to-ward",
    }, selfHref);
  }

  const sameDate = others
    .filter((contest) => contest.contest.polling_day === current.contest.polling_day)
    .sort((a, b) =>
      `${a.contest.council_name} ${a.contest.ward_name}`.localeCompare(
        `${b.contest.council_name} ${b.contest.ward_name}`,
        "en-GB",
      ),
    )[0];
  if (sameDate) {
    addUnique(links, {
      href: localHref(sameDate),
      label: `${sameDate.contest.ward_name}, ${sameDate.contest.council_name}`,
      description: `Another council by-election on ${shortDate(current.contest.polling_day)}.`,
      trackingId: "byelection-same-date",
    }, selfHref);
  }

  const sameCouncil = others
    .filter(
      (contest) =>
        contest.contest.council_slug &&
        contest.contest.council_slug === current.contest.council_slug,
    )
    .sort((a, b) => {
      const aDistance = Math.abs(Date.parse(a.contest.polling_day) - Date.parse(current.contest.polling_day));
      const bDistance = Math.abs(Date.parse(b.contest.polling_day) - Date.parse(current.contest.polling_day));
      return aDistance - bDistance || a.contest.ward_name.localeCompare(b.contest.ward_name, "en-GB");
    })[0];
  if (sameCouncil) {
    addUnique(links, {
      href: localHref(sameCouncil),
      label: `${sameCouncil.contest.ward_name}, ${sameCouncil.contest.council_name}`,
      description: "Another recent contest from the same council.",
      trackingId: "byelection-same-council",
    }, selfHref);
  }

  const nextUpcoming = others
    .filter((contest) => contest.contest.polling_day >= today)
    .sort(
      (a, b) =>
        a.contest.polling_day.localeCompare(b.contest.polling_day) ||
        a.contest.ward_name.localeCompare(b.contest.ward_name, "en-GB"),
    )[0];
  if (nextUpcoming) {
    addUnique(links, {
      href: localHref(nextUpcoming),
      label: `${nextUpcoming.contest.ward_name}, ${nextUpcoming.contest.council_name}`,
      description: `Next upcoming contest, polling ${shortDate(nextUpcoming.contest.polling_day)}.`,
      trackingId: "byelection-next-upcoming",
    }, selfHref);
  }

  const recentResult = others
    .filter(
      (contest) =>
        contest.contest.polling_day < today && Boolean(contest.result?.declared),
    )
    .sort(
      (a, b) =>
        b.contest.polling_day.localeCompare(a.contest.polling_day) ||
        a.contest.ward_name.localeCompare(b.contest.ward_name, "en-GB"),
    )[0];
  if (recentResult) {
    addUnique(links, {
      href: localHref(recentResult),
      label: `${recentResult.contest.ward_name}, ${recentResult.contest.council_name}`,
      description: `A recently declared result from ${shortDate(recentResult.contest.polling_day)}.`,
      trackingId: "byelection-recent-result",
    }, selfHref);
  }

  addUnique(links, {
    href: "/by-elections/local/",
    label: "Council by-election scorecard",
    description: "Browse every upcoming contest, recent result and published model grade.",
    trackingId: "byelection-to-index",
  }, selfHref);
  addUnique(links, {
    href: "/methodology/local-by-elections/",
    label: "Council by-election methodology",
    description: "See how the projections, uncertainty and track record are calculated.",
    trackingId: "byelection-to-methodology",
  }, selfHref);

  return links.slice(0, 6);
}
