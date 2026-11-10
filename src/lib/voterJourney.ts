// Voter journey: the steps a vote goes through at one contest, for people
// voting in person, by post and by proxy.
//
// PROTOTYPE. Two rules hold the design together:
//
// 1. Every date comes from the Democracy Club timetable for the contest. This
//    file computes no deadline. Working-day arithmetic is a legal judgement
//    (excluded days differ by nation and instrument) and the law is in motion,
//    so a rule with no dated feed behind it is shown in words, never as a date.
// 2. Every step says how far its date can be trusted: fixed by law, set by the
//    council, or impossible for any website to know. The UK has no way to track
//    a postal ballot, and the tracker must not look as if it does.
//
// Sources for each provision are in the estate pack,
// Website_Audits/UKE_Voter_Journey_Research_2026-11-10.md. They were read as
// extracts and need re-reading at source before this leaves prototype.

export type Lane = "person" | "post" | "proxy";
export type Certainty = "law" | "council" | "unknown";
export type Phase = "before" | "day" | "after";
export type Territory = "ENG" | "WLS" | "SCT";

export interface Link {
  label: string;
  url: string;
}

export interface JourneyStep {
  id: string;
  lanes: Lane[];
  phase: Phase;
  title: string;
  /** Short imperative used in the "still open" list, when the voter can act. */
  action?: string;
  certainty: Certainty;
  /** ISO date the step falls on or ends on, from the feed. */
  date?: string;
  /** Clock time of the deadline on `date`, 24 hour, London. */
  time?: string;
  /** ISO date a window opens, from the feed. */
  opensDate?: string;
  /** Used when there is no dated value to show. */
  whenText?: string;
  body: string;
  /** Shown once the deadline has passed: what a voter can still do. */
  missed?: string;
  basis?: Link;
  official?: Link;
}

export interface JourneyInput {
  pollingDay: string;
  territory: string;
  councilName: string;
  wardName: string;
  requiresVoterId: string | null;
  timetable: Record<string, string | null> | null;
}

export const LANES: Array<{ id: Lane; label: string; short: string }> = [
  { id: "person", label: "I will vote in person", short: "In person" },
  { id: "post", label: "I will vote by post", short: "By post" },
  { id: "proxy", label: "Someone will vote for me", short: "By proxy" },
];

export const CERTAINTY_LABEL: Record<Certainty, string> = {
  law: "Fixed by law",
  council: "Set by your council",
  unknown: "Cannot be known",
};

const ALL: Lane[] = ["person", "post", "proxy"];
const LEG = "https://www.legislation.gov.uk";

/** The rules instrument that sets the election timetable, by nation. */
function timetableBasis(t: Territory): Link {
  if (t === "SCT") return { label: "Scottish Local Government Elections Order 2011, Schedule 1, rule 1", url: `${LEG}/ssi/2011/399/schedule/1` };
  if (t === "WLS") return { label: "Local Elections (Principal Areas) (Wales) Rules 2021, Schedule 1, rule 1", url: `${LEG}/wsi/2021/1459/schedule/1` };
  return { label: "Local Elections (Principal Areas) (England and Wales) Rules 2006, Schedule 2, rule 1", url: `${LEG}/uksi/2006/3304/schedule/2` };
}

function absentVoteBasis(t: Territory): Link {
  if (t === "SCT") return { label: "Representation of the People (Scotland) Regulations 2001, regulation 56", url: `${LEG}/uksi/2001/497/regulation/56` };
  return { label: "Representation of the People (England and Wales) Regulations 2001, regulation 56", url: `${LEG}/uksi/2001/341/regulation/56` };
}

export function supportedTerritory(territory: string): territory is Territory {
  return territory === "ENG" || territory === "WLS" || territory === "SCT";
}

export function buildJourney(input: JourneyInput): JourneyStep[] {
  if (!supportedTerritory(input.territory)) return [];
  const t = input.territory;
  const tt = input.timetable ?? {};
  const council = input.councilName;
  const idNeeded = Boolean(input.requiresVoterId);
  const eng = t === "ENG";
  const engWales = t !== "SCT";
  const steps: JourneyStep[] = [];
  const add = (s: JourneyStep | false | null | undefined | "") => {
    if (s) steps.push(s);
  };

  // ---- Before polling day ------------------------------------------------
  add(tt.notice_of_election_deadline && {
    id: "notice",
    lanes: ALL,
    phase: "before",
    title: "Election announced",
    certainty: "law",
    date: tt.notice_of_election_deadline,
    body: `${council} publishes the notice of election by this date. It is the formal start of the contest.`,
    basis: timetableBasis(t),
  });
  add(tt.close_of_nominations && {
    id: "nominations",
    lanes: ALL,
    phase: "before",
    title: "Nominations close",
    certainty: "law",
    date: tt.close_of_nominations,
    time: "16:00",
    body: "Nobody can stand after this. The council then publishes the list of everyone who is standing.",
    basis: timetableBasis(t),
  });
  add(tt.registration_deadline && {
    id: "register",
    lanes: ALL,
    phase: "before",
    title: "Register to vote",
    action: "Register to vote",
    certainty: "law",
    date: tt.registration_deadline,
    time: "23:59",
    body: "You can only vote if you are on the register. It takes about five minutes online. If you have moved, you need to register again.",
    missed: "If you are not on the register you cannot vote in this contest. Registering now puts you on it for the next one.",
    basis: { label: "Representation of the People Act 1983, section 13B", url: `${LEG}/ukpga/1983/2/section/13B` },
    official: { label: "Register to vote on GOV.UK", url: "https://www.gov.uk/register-to-vote" },
  });
  add(tt.postal_vote_application_deadline && {
    id: "postal-apply",
    lanes: ["post"],
    phase: "before",
    title: "Apply for a postal vote",
    action: "Apply for a postal vote",
    certainty: "law",
    date: tt.postal_vote_application_deadline,
    time: "17:00",
    body: "The same deadline applies if you want to change or cancel a postal vote you already have. You will be asked for a signature and your date of birth: both are checked again when your vote comes back.",
    missed: "Missed it? You can still vote in person, or by emergency proxy if you qualify.",
    basis: absentVoteBasis(t),
    official: { label: "Apply for a postal vote on GOV.UK", url: "https://www.gov.uk/apply-postal-vote" },
  });
  add({
    id: "postal-decision",
    lanes: ["post"],
    phase: "before",
    title: "Your council decides your application",
    certainty: "unknown",
    whenText: "No date is set",
    body: `The law gives no deadline for the decision. ${council} writes to tell you whether you have a postal vote.`,
    official: { label: "Find your electoral registration office", url: "https://www.gov.uk/contact-electoral-registration-office" },
  });
  add({
    id: "postal-issue",
    lanes: ["post"],
    phase: "before",
    title: "Postal packs are sent out",
    certainty: "council",
    whenText: "After nominations close",
    body: `${council} chooses the days it posts packs, often in more than one batch. Many councils publish those days on their own website. This site does not hold them yet.`,
    basis: engWales
      ? { label: "Representation of the People (England and Wales) Regulations 2001, regulation 71", url: `${LEG}/uksi/2001/341/regulation/71` }
      : undefined,
    official: { label: "Find your electoral registration office", url: "https://www.gov.uk/contact-electoral-registration-office" },
  });
  add({
    id: "postal-arrive",
    lanes: ["post"],
    phase: "before",
    title: "Your pack arrives",
    certainty: "unknown",
    whenText: "Depends on the post",
    body: "Nobody can track a postal ballot in the UK: not this site, not your council. If yours has not come, the replacement step below is the route.",
  });
  add(tt.proxy_vote_application_deadline && {
    id: "proxy-apply",
    lanes: ["proxy"],
    phase: "before",
    title: "Apply for a proxy vote",
    action: "Apply for a proxy vote",
    certainty: "law",
    date: tt.proxy_vote_application_deadline,
    time: "17:00",
    body: "A proxy is someone you trust who votes on your behalf. They must be registered to vote too.",
    missed: "Missed it? An emergency proxy is possible until 5pm on polling day, for the reasons listed under polling day.",
    basis: absentVoteBasis(t),
    official: { label: "Apply for a proxy vote on GOV.UK", url: "https://www.gov.uk/apply-proxy-vote" },
  });
  add(idNeeded && tt.vac_application_deadline && {
    id: "voter-id",
    lanes: ["person", "proxy"],
    phase: "before",
    title: "Apply for free voter ID",
    action: "Apply for free voter ID",
    certainty: "law",
    date: tt.vac_application_deadline,
    time: "17:00",
    body: "You need photo ID to vote in person at this election. If you have none of the accepted kinds, a Voter Authority Certificate is free. Out of date photo ID is accepted.",
    missed: "Missed it? Check whether you hold another accepted photo ID. Out of date ID counts.",
    basis: { label: "Voter Identification Regulations 2022", url: `${LEG}/uksi/2022/1382/made` },
    official: { label: "Check which photo ID is accepted on GOV.UK", url: "https://www.gov.uk/how-to-vote/photo-id-youll-need" },
  });
  add(tt.replacement_pack_start_date && {
    id: "postal-replace",
    lanes: ["post"],
    phase: "before",
    title: "Ask for a replacement pack",
    action: "Ask for a replacement postal pack",
    certainty: "law",
    opensDate: tt.replacement_pack_start_date,
    date: input.pollingDay,
    time: "17:00",
    body: `If your pack is lost, spoilt or has not arrived, ${council} can issue another.${engWales ? " After 5pm on the day before polling day you have to collect it in person." : ""}`,
    basis: engWales
      ? { label: "Representation of the People (England and Wales) Regulations 2001, regulation 78", url: `${LEG}/uksi/2001/341/regulation/78` }
      : undefined,
    official: { label: "Find your electoral registration office", url: "https://www.gov.uk/contact-electoral-registration-office" },
  });

  // ---- Polling day -------------------------------------------------------
  add({
    id: "poll",
    lanes: ["person", "proxy"],
    phase: "day",
    title: "Polling day",
    action: "Vote at your polling station",
    certainty: "law",
    date: input.pollingDay,
    time: "22:00",
    whenText: "7am to 10pm",
    body: idNeeded
      ? `Bring photo ID. You do not need your poll card.${eng ? " If you are in the queue at 10pm you can still vote." : ""}`
      : "No photo ID is needed at this election. You do not need your poll card.",
    basis: timetableBasis(t),
    official: { label: "Voting in person on GOV.UK", url: "https://www.gov.uk/how-to-vote/voting-in-person" },
  });
  add({
    id: "emergency-proxy",
    lanes: ["person", "proxy"],
    phase: "day",
    title: "Emergency proxy",
    action: "If you cannot get there: emergency proxy",
    certainty: "law",
    date: input.pollingDay,
    time: "17:00",
    body: `If something happens after the proxy deadline and you cannot get to the polling station, you can still ask for a proxy: for a medical emergency or disability, or because of work${idNeeded ? ", or because your photo ID is lost, stolen, damaged or has not arrived" : ""}.`,
    basis: absentVoteBasis(t),
    official: { label: "Emergency proxy votes on GOV.UK", url: "https://www.gov.uk/how-to-vote/voting-by-proxy" },
  });
  add({
    id: "postal-return",
    lanes: ["post"],
    phase: "day",
    title: "Your postal vote must be back",
    action: "Return your postal vote",
    certainty: "law",
    date: input.pollingDay,
    time: "22:00",
    whenText: "By 10pm",
    body: eng
      ? `Post it early enough to arrive, or hand it in. To hand it in, give it to staff at a polling station in ${council} or at the council office and fill in the form: a postal vote left without the form is rejected. You can hand in your own and up to five others.`
      : "Post it early enough to arrive, or hand it in. The rules for handing in a postal vote differ between nations, so check the official page.",
    basis: eng
      ? { label: "Representation of the People (England and Wales) Regulations 2001, regulation 82B", url: `${LEG}/uksi/2001/341/regulation/82B` }
      : undefined,
    official: { label: "Postal voting on GOV.UK", url: "https://www.gov.uk/how-to-vote/postal-voting" },
  });

  // ---- After polls close -------------------------------------------------
  add({
    id: "postal-check",
    lanes: ["post"],
    phase: "after",
    title: "Signature and date of birth checked",
    certainty: "unknown",
    whenText: "Before the count",
    body: "Each returned postal vote is checked against the signature and date of birth on the application. You are not told the outcome at the time.",
  });
  add({
    id: "count",
    lanes: ALL,
    phase: "after",
    title: "Votes counted and result declared",
    certainty: "council",
    whenText: "After 10pm",
    body: "The returning officer decides when the count starts. This page shows the result once it is declared.",
  });
  add(engWales && {
    id: "postal-rejection",
    lanes: ["post"],
    phase: "after",
    title: "A letter if your postal vote was rejected",
    certainty: "law",
    whenText: "Within three months",
    body: "If your vote was not counted, for example because the signature or date of birth did not match, the registration officer must write and say why. This is the only individual feedback the system gives, and it comes after the result.",
    basis: { label: "Representation of the People (England and Wales) Regulations 2001, regulation 61C", url: `${LEG}/uksi/2001/341/regulation/61C` },
  });
  add(engWales && {
    id: "acceptance",
    lanes: ALL,
    phase: "after",
    title: "The winner takes office",
    certainty: "law",
    whenText: "Within two months",
    body: "The new councillor must sign a declaration accepting the office. If they do not, the seat becomes vacant again.",
    basis: { label: "Local Government Act 1972, section 83", url: `${LEG}/ukpga/1972/70/section/83` },
  });
  add(engWales && {
    id: "scrutiny",
    lanes: ALL,
    phase: "after",
    title: "Spending declared, result open to challenge",
    certainty: "law",
    whenText: "In the weeks after",
    body: "Candidates must file what they spent within 35 days of the result. A challenge to the result must be brought within 21 days of polling day.",
    basis: { label: "Representation of the People Act 1983, sections 81 and 129", url: `${LEG}/ukpga/1983/2/section/81` },
  });

  return steps;
}

// ---- Time ---------------------------------------------------------------

/** The instant a London wall-clock time falls on, as epoch milliseconds. */
export function londonInstant(isoDate: string, hhmm: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, hhmm === "23:59" ? 59 : 0);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), hhmm === "23:59" ? 59 : 0);
  return guess - (shown - guess);
}

/** When a step stops being possible. Steps with no feed date never expire. */
export function stepDeadline(step: JourneyStep): number | null {
  if (!step.date) return null;
  return londonInstant(step.date, step.time ?? "23:59");
}

export function stepOpens(step: JourneyStep): number | null {
  return step.opensDate ? londonInstant(step.opensDate, "00:00") : null;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]} ${d} ${MONTHS[m - 1]}`;
}

export function timeLabel(hhmm: string | undefined): string {
  if (!hhmm) return "";
  if (hhmm === "23:59") return "midnight";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}.${String(m).padStart(2, "0")}${suffix}` : `${hour}${suffix}`;
}

/** "by 5pm on Wednesday 4 November", "Monday 19 October", "7am to 10pm on Thursday 12 November". */
export function whenLabel(step: JourneyStep): string {
  if (step.id === "poll") return `7am to 10pm on ${dayLabel(step.date!)}`;
  if (step.opensDate && step.date) return `${dayLabel(step.opensDate)} to ${timeLabel(step.time)} on ${dayLabel(step.date)}`;
  if (step.date && step.time) return `By ${timeLabel(step.time)} on ${dayLabel(step.date)}`;
  if (step.date) return `By ${dayLabel(step.date)}`;
  return step.whenText ?? "";
}

export type StepState = "done" | "open" | "later" | "info";

export function stepState(step: JourneyStep, now: number): StepState {
  const deadline = stepDeadline(step);
  if (deadline === null) return "info";
  if (now > deadline) return "done";
  const opens = stepOpens(step);
  if (opens !== null && now < opens) return "later";
  return "open";
}
