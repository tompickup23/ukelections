# UK Demographics — Brand Guide

## Identity

**Name:** UK Demographics
**Tagline:** Population Data for Every Community
**Subtitle:** Ethnic projections, school demand, housing pressure, and demographic change
**Concept:** Rising population bars with a projection trend line. The bars represent growing demographic scale across local authorities. The trend line shows the forward trajectory — projections from Census 2021 to 2051. Green endpoint = where the data points.

## Logo Variants

| File | Use Case |
|------|----------|
| `logo.svg` | Primary horizontal — website header, press, reports |
| `logo-stacked.svg` | Square — social media avatars, app icon |
| `icon.svg` | Bars icon only (dark bg) — favicons, UI elements |
| `icon-light.svg` | Bars icon only (light bg) — print, email |
| `favicon.svg` | Browser tab (32x32, dark bg with bars) |
| `apple-touch-icon.svg` | iOS home screen (180x180) |

## Color System

### Primary Palette

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| **Indigo** | `#4f46e5` | 79, 70, 229 | Primary accent, bars, links, interactive elements |
| **Indigo Light** | `#818cf8` | 129, 140, 248 | Trend lines, hover states, secondary emphasis |
| **Indigo Dark** | `#4338ca` | 67, 56, 202 | Light-bg variant |
| **Emerald** | `#10b981` | 16, 185, 129 | Positive, endpoint, growth indicators |
| **Cyan** | `#06b6d4` | 6, 182, 212 | Secondary accent, cross-reference to Asylum Stats |

### Surface Palette

| Name | Hex | Usage |
|------|-----|-------|
| **Abyss** | `#04070d` | Page background — near-black with blue undertone |
| **Deep** | `#0b1220` | Card backgrounds, elevated surfaces |
| **Slate** | `#1e293b` | Borders, dividers, input backgrounds |
| **Muted** | `#91a7c4` | Secondary text, labels, timestamps |
| **Ink Soft** | `#dbe7f7` | Body text |
| **Ink** | `#f5f7fb` | Headings, emphasis, primary text |

### Semantic Data Colors

| Meaning | Hex | Usage |
|---------|-----|-------|
| **Growth** | `#10b981` | Population increase, positive change |
| **Projection** | `#4f46e5` | Indigo — projected values, estimates |
| **Historical** | `#818cf8` | Light indigo — Census/observed data |
| **Critical** | `#ef4444` | Red — rapid change, threshold breach |
| **Neutral** | `#6b7280` | Grey — no data, pending |

## Typography

**Primary:** Manrope (variable weight, geometric sans-serif)
**Secondary:** Sora (for accent text)
**Fallback:** Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif

| Element | Weight | Size | Tracking |
|---------|--------|------|----------|
| H1 | 800 | 32px | -0.5px |
| H2 | 700 | 24px | -0.3px |
| H3 | 600 | 18px | 0 |
| Body | 400 | 16px | 0 |
| Caption/Label | 500 | 12px | 1px |
| "DEMOGRAPHICS" subtitle | 400 | varies | 3-4px |
| KPI Value | 800 | 48px | -1px |

## The Population Bars Icon

The rising bars chart is the core brand mark:
- **4 bars, ascending height** — demographic scale across communities
- **Decreasing opacity** — uncertainty increasing with projection horizon
- **Trend line** — the projection trajectory, showing direction of change
- **Start dot (indigo light)** — Census 2021 observed baseline
- **End dot (green)** — projection endpoint, forward-looking
- **No radar, no surveillance** — neutral data presentation, not tracking

### Icon at Scale
- 80px+: Full detail (all bars, trend line, both dots)
- 32-64px: Simplified (bars + trend line)
- 16-24px: Minimal (3 ascending bars)

## Logo Usage Rules

1. **Dark backgrounds only** for primary logo — the bars need contrast
2. Use `icon-light.svg` on white/light backgrounds (darker indigo #4338ca)
3. **Minimum size:** Icon at 24px, full logo at 160px wide
4. **Clear space:** 1x icon height on all sides
5. **Never** flatten the bar opacity gradient (it encodes uncertainty)
6. **Never** reverse the bar order (ascending = growth/change)
7. The trend line always rises left-to-right — it represents demographic projection

## CSS Custom Properties

```css
:root {
  --ukd-bg: #04070d;
  --ukd-bg-soft: #0b1220;
  --ukd-ink: #f5f7fb;
  --ukd-ink-soft: #dbe7f7;
  --ukd-muted: #91a7c4;
  --ukd-indigo: #4f46e5;
  --ukd-indigo-light: #818cf8;
  --ukd-indigo-dark: #4338ca;
  --ukd-emerald: #10b981;
  --ukd-cyan: #06b6d4;
  --ukd-red: #ef4444;
  --ukd-border: #1e293b;
  --ukd-radius: 28px;
  --ukd-radius-sm: 20px;
  --ukd-font: 'Manrope', Inter, -apple-system, system-ui, sans-serif;
}
```

## Social Media Specs

| Platform | Format | Size | Notes |
|----------|--------|------|-------|
| OG Image | 1200x630 | Bars + headline + stat | Dark bg, indigo accent |
| Twitter/X | 1200x628 | Same as OG | |
| Instagram Post | 1080x1080 | Stacked logo + stat + headline | |
| Instagram Reel | 1080x1920 | Vertical, bars top, data below | |
| Avatar | 400x400 | `logo-stacked.svg` on dark bg | |
| Favicon | 32x32 | `favicon.svg` | |
| Apple Touch | 180x180 | `apple-touch-icon.svg` | |

## Relationship to Asylum Stats

UK Demographics is a neutral demographic research platform. Asylum Stats (asylumstats.co.uk) is the asylum-focused accountability platform. They share:
- Same dark aesthetic (proven readable, professional)
- Same typography (Manrope + Sora)
- Same surface palette (abyss, deep, slate)
- Different accent colors (indigo vs cyan) for instant visual distinction
- Cross-links in footers

## Legal Notes

- "UK Demographics" is purely descriptive — tracks public demographic data
- All data sourced from official government publications (ONS Census, SNPP, DfE)
- The population bars icon is original artwork
- The color palette uses standard Tailwind CSS colors
- Content follows strict editorial scope rules
