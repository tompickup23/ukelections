// Lucide icon shortlist used by StatCard + ad-hoc places.
//
// `?raw` imports each SVG as a string at build time; we render it inline
// via `set:html` so CSS can size via `currentColor` + `em` units. Add icons
// here as needed. keep the list small to bound bundle bytes.

import crown from "lucide-static/icons/crown.svg?raw";
import vote from "lucide-static/icons/vote.svg?raw";
import target from "lucide-static/icons/target.svg?raw";
import landmark from "lucide-static/icons/landmark.svg?raw";
import circleCheck from "lucide-static/icons/circle-check.svg?raw";
import circleAlert from "lucide-static/icons/circle-alert.svg?raw";
import calendar from "lucide-static/icons/calendar.svg?raw";
import pause from "lucide-static/icons/circle-pause.svg?raw";
import trendingUp from "lucide-static/icons/trending-up.svg?raw";
import trendingDown from "lucide-static/icons/trending-down.svg?raw";
import gauge from "lucide-static/icons/gauge.svg?raw";
import users from "lucide-static/icons/users.svg?raw";
import scale from "lucide-static/icons/scale.svg?raw";
import flag from "lucide-static/icons/flag.svg?raw";
import map from "lucide-static/icons/map.svg?raw";

export const ICONS = {
  crown,
  vote,
  target,
  landmark,
  "circle-check": circleCheck,
  "circle-alert": circleAlert,
  calendar,
  pause,
  "trending-up": trendingUp,
  "trending-down": trendingDown,
  gauge,
  users,
  scale,
  flag,
  map,
} as const;

export type IconName = keyof typeof ICONS;
