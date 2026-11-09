---
version: alpha
name: usahaku
description: Bookkeeping app for Indonesian UMKM in the visual language of Docs/notion-DESIGN.md, applied to product screens, light theme only.
colors:
  primary: "#5645d4"
  primary-pressed: "#4534b3"
  primary-deep: "#3a2a99"
  navy: "#0a1530"
  navy-mid: "#1a2a52"
  link: "#0075de"
  link-pressed: "#005bab"
  canvas: "#ffffff"
  surface: "#f6f5f4"
  surface-soft: "#fafaf9"
  hairline: "#e5e3df"
  hairline-soft: "#ede9e4"
  hairline-strong: "#c8c4be"
  ink: "#1a1a1a"
  ink-deep: "#000000"
  charcoal: "#37352f"
  slate: "#5d5b54"
  steel: "#6b6965"
  on-dark-muted: "#c8c4be"
  tint-mint: "#d9f3e1"
  tint-lavender: "#e6e0f5"
  tint-sky: "#dcecfa"
  tint-peach: "#ffe8d4"
  tint-yellow: "#fef7d6"
  tint-yellow-bold: "#f9e79f"
  tint-rose: "#fde0ec"
  tint-gray: "#f0eeec"
  danger: "#e03131"
  danger-deep: "#b42318"
typography:
  display:
    fontFamily: Inter Variable
    fontSize: 64px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: -0.03em
  display-sm:
    fontFamily: Inter Variable
    fontSize: 44px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: -0.03em
  auth-heading:
    fontFamily: Inter Variable
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.02em
  tile-figure:
    fontFamily: Inter Variable
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.25
  h3:
    fontFamily: Inter Variable
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.25
  h4:
    fontFamily: Inter Variable
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.3
  h5:
    fontFamily: Inter Variable
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: Inter Variable
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: Inter Variable
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: Inter Variable
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  full: 9999px
spacing:
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.canvas}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: 56px
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: 48px
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: 52px
  card:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
  pill-tab-active:
    backgroundColor: "{colors.ink-deep}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.full}"
    padding: "0 16px"
---

# usahaku design system

Dial: ENERGY 2 / RHYTHM 2 / MOTION 1.

## Overview

An older shop owner uses this between customers, in daylight, on a phone or a desktop. The navy band with one large number answers "am I making money today" first. Below it are three big buttons and nothing else to learn. Everything is calm, flat, large, and readable. Character comes from the navy band, the white card that lifts over it, and pastel tiles, not from decoration inside the working screens.

The owner asked for the visual language of `Docs/notion-DESIGN.md` at full fidelity. It borrows that language only. The Notion name, logo, and marketing content are not used.

## Colors

- **Purple** is for the action that moves work forward and for the current tab. Never for body text or large areas.
- **Navy** owns the band at the top of the home screen and the sign-in pages. Nothing else.
- **Link blue** is only for inline text links, never mixed with the purple button role.
- **Pastel tints each mean one thing:** mint confirms something was saved and marks sales, peach marks expenses, lavender marks balances and profit reading.
- **Rose** shows a negative profit on the navy band, where the deep red would fail contrast.
- Light theme only: the scene is a bright counter, and the direction document defines no dark tokens.

## Typography

One family, Inter Variable, self-hosted. It is the fallback the direction document names, since Notion Sans is proprietary. Tabular numerals (`.num`) on every money figure so columns align. Main text is 18px and nothing is under 16px, because the reader is older. Only the home profit figure and sign-in headings go above 28px.

## Elevation

Flat by default with a 1px hairline. Shadow has two jobs only: the white card over the navy band (`mockup`) and dialogs (`modal`). Tiles gain a light `card` shadow on hover to show they are links.

## Components

- Buttons are 8px rectangles. Main buttons are at least 56px tall, the big home buttons 72px, and other buttons 48px. Inputs are 52px. Pills are only for filters and tabs.
- Lists are rows inside one card, not a grid of cards, so a long day of entries stays scannable on a phone.
- Dialogs are the native `dialog`: bottom sheet on phones, centered from `sm`. The browser handles focus trap, Escape, and focus return.
- Every list has skeleton, empty (cause plus next action), and error (reason plus retry) states.
- Icons are authored in `components/Icon.jsx` with one 1.75 stroke.
- The home screen is the navigation: profit, three big buttons, and a link to Menu lain. There is no bottom tab bar on phones. Every other screen has Kembali ke Beranda.
- The desktop nav links are centred and share one `tint-gray` block that glides to the hovered or keyboard-focused link in 200 ms and fades when the pointer leaves. The current page gets a semibold label and a 4px purple dot, never the block.
- Forms show only what the task needs. Anything optional sits closed under Pilihan lain, and opens by itself when it holds an error.

## Do and don't

- Do keep the three data states on every new list.
- Do use Indonesian shop language: laba, stok, modal.
- Don't add a tint without assigning it one meaning.
- Don't add motion beyond state changes, 150 to 250 ms.
- The app icon `public/icon.svg` is a placeholder until a real logo exists.
