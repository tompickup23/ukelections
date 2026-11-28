// Read an Electoral Changes Order (legislation.gov.uk XML) for what it does at
// the May 2027 ordinary elections:
//   - redraw: the explanatory note says the order replaces the wards (or
//     divisions) with new ones from the 2027 ordinary elections; the ward
//     schedule gives names and councillors;
//   - related_alteration: a parish-led transfer of an area between named
//     district wards, in force from 2027;
//   - retirement: an earlier redraw whose article 4 (or a retirement schedule)
//     says how many of each ward's councillors retire, and so are elected, in
//     2027.
// Everything returned is read from the order's text; nothing is inferred
// beyond what the regular expressions match, and a miss is returned as null.

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 };

export function decode(s) {
  return String(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// Each <Schedule> with its title, table rows (cells as text) and list items.
export function schedules(xml) {
  const out = [];
  for (const m of xml.matchAll(/<Schedule\b[^>]*>([\s\S]*?)<\/Schedule>/g)) {
    const body = m[1];
    const title = decode((body.match(/<Title>([\s\S]*?)<\/Title>/) || [])[1] || "");
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => decode(c[1])));
    const items = [...body.matchAll(/<ListItem\b[^>]*>([\s\S]*?)<\/ListItem>/g)].map((i) => decode(i[1]).replace(/^\d+\.?\s+/, ""));
    out.push({ title, rows, items });
  }
  return out;
}

function noteText(xml) {
  const m = xml.match(/<ExplanatoryNotes\b[\s\S]*?<\/ExplanatoryNotes>/);
  return m ? decode(m[0]) : "";
}

function bodyText(xml) {
  const m = xml.match(/<Body\b[\s\S]*?<\/Body>/);
  return m ? decode(m[0]) : decode(xml);
}

const num = (s) => (/^\d+$/.test(s) ? Number(s) : WORDS[String(s).toLowerCase()] ?? null);

export function readOrder(xml) {
  const note = noteText(xml);
  const body = bodyText(xml);
  const scheds = schedules(xml);
  const result = { effect_2027: null, redraw: null, related_alteration: null, retirement_2027: null };

  // Redraw from 2027.
  const rd = note.match(/replaces them with (?:the )?(\d+) new ones(?: listed in (?:Schedule 1|the Schedule))? for the purposes? of elections (?:to be )?(?:held )?on or after the ordinary day of election of councillors in England in (\d{4})/);
  if (rd) {
    const year = Number(rd[2]);
    const count = Number(rd[1]);
    const unit = /electoral divisions/.test(note.slice(0, rd.index + 200)) ? "division" : "ward";
    const s = scheds.find((x) => /^(Wards|Electoral [Dd]ivisions) of/.test(x.title) && !/parish/i.test(x.title)) || scheds[0];
    let wards = null;
    if (s) {
      const isHeader = (r) => r.some((c) => /^\(\d\)|Name of|Number of councillors|^(City|District|Borough) ward$/i.test(c));
      const pairs = s.rows.filter((r) => r.length >= 2 && !isHeader(r) && /^\d+$/.test(r[r.length - 1]) && r[0] && !/^\d+\.?$/.test(r[0]));
      const numbered = s.rows.filter((r) => r.length >= 2 && /^\d+\.?$/.test(r[0]) && r[r.length - 1] && !/^\d+$/.test(r[r.length - 1]));
      if (pairs.length) wards = pairs.map((r) => ({ name: r[0], councillors: Number(r[r.length - 1]) }));
      else if (numbered.length) wards = numbered.map((r) => ({ name: r[r.length - 1], councillors: null }));
      else if (s.items.length) wards = s.items.map((name) => ({ name, councillors: null }));
      else if (s.rows.length) wards = s.rows.filter((r) => r.length === 1 && r[0]).map((r) => ({ name: r[0].replace(/^\d+\.?\s+/, ""), councillors: null }));
    }
    // "The number of councillors to be elected for each ward is three[, save
    // for the ward of X, in which the number of councillors to be elected is 2]."
    const uni = body.match(/number of councillors to be elected for each (?:ward|electoral division) is (one|two|three|four|\d)(?:, save for the ward of ([^,]+), in (?:which|respect of which) the number of councillors to be elected is (one|two|three|\d))?/);
    if (wards && uni) {
      for (const w of wards) {
        if (w.councillors != null) continue;
        w.councillors = uni[2] && w.name === decode(uni[2]) ? num(uni[3]) : num(uni[1]);
      }
    }
    result.redraw = { year, wards_in_note: count, unit, schedule_title: s?.title || null, wards, uniform_rule: uni ? uni[0] : null };
    if (year === 2027) result.effect_2027 = "redraw";
  }

  // Related alteration between named district wards, from 2027.
  if (/related alteration/i.test(note)) {
    const sec = body.match(/Alteration of (?:the |a )?(?:district )?ward boundar(?:y|ies)([\s\S]*?)(?:Sealed with the seal|$)/);
    const txt = sec ? sec[1] : "";
    const names = new Set();
    for (const m of txt.matchAll(/part of the ([A-Z][A-Za-z’'&,\- ]+?) district ward/g)) names.add(m[1].trim());
    if (names.size) {
      const commence = body.match(/Article (\d+) comes? into force[^.]*?for all other purposes, on the ordinary day of election of councillors in England in (\d{4})/g) || [];
      result.related_alteration = { wards: [...names], text: decode(txt).slice(0, 900) };
      // The district-ward article is the one heading "Alteration of district
      // ward boundaries"; the commencement article gives it a year. Orders in
      // this set put it in 2027 (checked in the commencement text).
      if (/in England in 2027/.test(commence.join(" ")) || /in England in 2027/.test(body.slice(0, 2500))) result.effect_2027 = result.effect_2027 || "related_alteration";
    }
  }

  // Retirement in 2027 after an earlier redraw.
  const ret = body.match(/Of the councillors elected for a ward in (\d{4})\s*[—-]\s*a one is to retire[^.;]*?in (\d{4})[;,] b one is to retire[^.;]*?in (\d{4})[;,](?: and)? c one is to retire[^.;]*?in (\d{4})/);
  if (ret && [ret[2], ret[3], ret[4]].includes("2027")) {
    const each = body.match(/number of councillors to be elected for each ward is (one|two|three|\d)\b/);
    result.retirement_2027 = { elected_in: Number(ret[1]), basis: "one_per_ward", councillors_per_ward: each ? num(each[1]) : null, quote: ret[0] };
  } else {
    const rs = scheds.find((x) => /Retirement of councillors/i.test(x.title));
    if (rs) {
      const header = rs.rows.find((r) => r.some((c) => /retire in 2027/i.test(c)));
      const col = header ? header.findIndex((c) => /retire in 2027/i.test(c)) : -1;
      if (col > 0) {
        const per = rs.rows.filter((r) => r !== header && r.length === header.length && /^\d+$/.test(r[col])).map((r) => ({ name: r[0], seats_2027: Number(r[col]) }));
        result.retirement_2027 = { basis: "schedule", schedule_title: rs.title, wards: per };
      }
    }
  }
  if (!result.effect_2027 && result.retirement_2027) result.effect_2027 = "retirement";
  return result;
}
