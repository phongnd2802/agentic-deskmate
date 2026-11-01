# Agentic DeskMate Design System

The source of truth for every screen. A file at `design-system/agentic-deskmate/pages/<page>.md` overrides this one for that page; otherwise these rules apply. Terms follow `GLOSSARY.md`.

**Direction:** a quiet, dense work tool. Neutral surfaces, one teal accent, hairline borders instead of shadows, and motion only where it explains a state change. The work is the visual interest, so an Answer or a table should always outweigh the chrome around it.

**Stack:** Next.js, Tailwind CSS v4, shadcn/ui, CopilotKit Chat, next-intl (`en`, `vi`), Bun.

Generated with ui-ux-pro-max (variance 2, motion 2, density 9), then corrected:

| Generated | Decision | Why |
|---|---|---|
| Mint background, teal borders | Neutral surfaces and borders | Tinted chrome competes with content across a full working day |
| Orange CTA, black text on teal | Teal is the only accent, white text on a darker teal | One action colour; dark text on mid-teal reads as disabled |
| Product Demo landing pattern | Application shell (§5) | This is a signed-in app, with no marketing page |
| GSAP scroll reveal, 200–250ms hovers, hover lifts | CSS only, 100ms (§4) | Conflicts with low motion, and GSAP is not a dependency |
| Base 16px, 44px controls everywhere | 14px, 32px on mouse, 44px on touch (§3) | Density, without failing touch users |
| `--space-*` variables | Tailwind's 4px spacing scale | Already in the stack |
| Token-by-token typewriter effect | Text appends as it arrives, unanimated (§6) | Reveal effects add delay and motion to real streaming |

## 1. Principles

1. **Density serves scanning.** Fit more on screen by trimming padding, never by shrinking text below 12px or dropping contrast.
2. **State is never colour alone.** Every status pairs an icon and a text label with its colour.
3. **Quiet by default, loud on exception.** A complete Answer gets no badge; a failed one does.
4. **Components before classes.** Use a shadcn component with semantic tokens. Raw hex, palette classes like `bg-teal-700`, and arbitrary values do not belong in components.

## 2. Tokens

Tokens live in `frontend/src/app/globals.css`, in OKLCH with light and dark sets, exposed to Tailwind through `@theme inline`. That file is the source of truth for values; change them there. Every text pair clears WCAG AA at 4.5:1 and every control boundary clears 3:1, in both modes, so re-check contrast after changing one.

| Group | Tokens |
|---|---|
| Surfaces | `background`, `card`, `popover`, `sidebar`, each with a `-foreground` pair |
| Actions | `primary`, `secondary`, `destructive`, each with a `-foreground` pair |
| Quiet | `muted` and `muted-foreground`; `accent` is shadcn's hover surface, not a brand colour |
| Status | `success`, `warning`, `info`, `destructive` |
| Edges | `border` for hairlines, `input` for field edges (3:1), `ring` for focus |

Three things in that file are easy to break:

- **`[data-copilotkit]` selectors.** CopilotKit declares the same variable names on that element, so `:root` alone never reaches Chat.
- **The `.cpk\:prose` rule.** CopilotKit hardcodes 16/28 on Answers, so this sets them to `text-prose`.
- **The `@source inline` line.** Streamdown's dark code colours are Tailwind classes, and Tailwind does not scan `node_modules`. Without it, dark mode shows light-theme token colours.

Fonts load through `next/font/google` in `frontend/src/app/layout.tsx`, with the Vietnamese subset. Next.js serves them itself, so a browser never calls Google. A plain CSS `@import` would.

**Status colours** (`success`, `warning`, `info`, `destructive`) are for text and icons, optionally over a `/10` tint of the same colour.

**Elevation:** borders separate in-page surfaces, so cards have no shadow. Floating layers use `shadow-md` (menus, popovers) or `shadow-lg` (dialogs). No backdrop blur; dialog overlays are `bg-black/50`.

## 3. Typography and density

| Class | Size / line | Use |
|---|---|---|
| `text-xs` | 12 / 16 | Timestamps, table headers, helper text. The floor: nothing smaller |
| `text-sm` | 13 / 18 | Controls, table cells, navigation, labels |
| `text-base` | 14 / 20 | Default UI text |
| `text-prose` | 15 / 24 | Answers and other long reading text |
| `text-lg` | 16 / 22 | Card and dialog titles |
| `text-xl` | 18 / 24 | Section headings |
| `text-2xl` | 22 / 28 | Page titles, at most one per page |

- Inter throughout, in weights 400, 500 and 600. JetBrains Mono for code, IDs and URLs.
- Use `tabular-nums` for numeric columns.
- Keep the line heights above. Vietnamese stacks diacritics (`ệ`, `ở`), and tighter leading clips them.
- Use sentence case for labels. All-caps Vietnamese is slow to read.
- Leave room for both locales: size to content, not to the English string.

Sizes use Tailwind's 4px scale. Gaps and padding come from 2, 4, 8, 12, 16, 24 and 32px.

| Element | Mouse | Touch (`pointer-coarse:`) |
|---|---|---|
| Button, Input, Select default | `h-8`, `px-3` | `min-h-11` |
| Button `sm` | `h-7`, `px-2.5` | `min-h-11` |
| Icon button | `size-8` | `size-11` |
| Checkbox, Switch hit area | at least 24px | 44px |
| Table row, sidebar item, menu item | `h-8` | `min-h-11` |
| Card / Popover / Dialog padding | `p-3` / `p-2` / `p-4` | same |
| Page padding, section gap | `p-4`, `gap-4` | same |
| Form field gap | `gap-3`, label above | same |

On touch, inputs use 16px text (`pointer-coarse:text-[16px]`) because iOS zooms the page on anything smaller.

## 4. Motion

Tailwind's `transition-colors` is already set to 100ms with an ease-out curve.

| Change | Duration | Properties |
|---|---|---|
| Hover, press, focus | 100ms | colour, background, border |
| Menu, popover, tooltip entering | 150ms | opacity |
| Dialog, sheet entering | 150ms | opacity |
| Anything leaving | 100ms | opacity |

Only animate colour and opacity. No scroll reveals, stagger, springs, hover lifts, scale effects or decorative loops. Loading placeholders are static `bg-muted` blocks with no shimmer. Show them only for waits over 300ms, and reserve the final height so content does not jump. With reduced motion on, a spinner stops, so a spinner always has a text label beside it.

## 5. Layout

- **Shell:** sidebar `w-56` (collapsed `w-12`), optional top bar `h-11`, and content scrolling on its own.
- **Below `md`:** the sidebar becomes a Sheet. There is no horizontal page scroll at 375px; wide tables scroll inside their own container.
- **Sidebar item:** `h-8 px-2 gap-2`, with a 16px icon and `text-sm`. The current page uses `aria-current="page"` with `bg-sidebar-accent` and `font-medium`.
- **Chat column:** `max-w-3xl` centred, which keeps Answers near 75 characters per line.
- **Pages:** title and primary action share the first row. Pages stay left-aligned; only the Chat column is centred.
- **Primary actions:** one per view. Everything else is `outline` or `ghost`.

## 6. Chat

An Answer has no bubble and runs the full column width in `text-prose`. The question sits right-aligned on `bg-muted` with `rounded-lg`.

| Answer state | Presentation |
|---|---|
| Streaming | `aria-busy="true"` on the Answer. Text appends as it arrives. Stop takes the Send button's position |
| Complete | No badge. Actions (copy, feedback, retry) in `text-muted-foreground` |
| Stopped | `CircleStop` icon and "Stopped" in `text-warning`. Partial text stays visible |
| Failed | `CircleAlert` icon and a plain cause in `text-destructive`, with a Retry button. Retrying adds another Answer to the same Conversation |

- Screen readers get one polite announcement when an Answer finishes, never each token.
- Follow new text only while the User is at the bottom. If they scroll up, stop following and offer scroll-to-bottom.
- Keep focus in the composer after sending, and return it there after Stop.

**Generative UI** (ADR 0004): while code is being written, show a static placeholder with a text label, with no live preview. The sandbox cannot inherit host CSS variables or fetch fonts, so resolved token values go in with the code and the font is the system stack. The link confirmation shows the full URL in `font-mono`.

## 7. Components

Use shadcn/ui with these changes:

- **Button:** variants `default`, `secondary`, `outline`, `ghost`, `destructive`; sizes `default`, `sm`, `icon`. Destructive actions confirm in a Dialog that names the thing being removed.
- **Focus:** `focus-visible:ring-2 focus-visible:ring-ring` on every interactive element, with `focus-visible:ring-offset-2 focus-visible:ring-offset-background` on filled buttons so the ring stays visible against them. No opacity modifier, since `ring-ring/50` falls under 3:1.
- **Input, Select, Textarea:** `border-input`. Labels are always visible, never placeholder-only. Errors sit under the field in `text-xs text-destructive`, linked with `aria-describedby`.
- **Table:** shadcn Table for lists, adding TanStack Table only once a table needs sorting or pagination. Headers are `text-xs font-medium text-muted-foreground`. Rows use `hover:bg-accent` and no zebra stripes. Truncated cells show the full value in a Tooltip.
- **Badge:** `text-xs`, `h-5`, `px-1.5`, with an icon when it conveys status.
- **Empty state:** one line of text and one action, without illustrations.
- **Icons:** Lucide at `size-4`, `aria-hidden` when beside text. Icon-only buttons need an `aria-label` from next-intl and a Tooltip. No emoji as icons.
- **User-facing text:** always through next-intl, in both `en.json` and `vi.json`.

## 8. Adding shadcn components

```bash
bunx --bun shadcn@latest add <component>
```

Run it in `frontend/`, then bring the result in line with this file:

- Keep `cn` from `@/lib/utils`, which knows `text-prose`. The CLI may rewrite it to the `cn` package.
- Remove `zoom-*` and `slide-in-*` classes from overlays, and `transition-all` and `active:translate-y-px` anywhere (§4).
- Replace `ring-ring/50` with a solid ring (§7).
- Check `globals.css` and `utils.ts` in the diff; the CLI may change them.

Not built yet: the mobile Sheet sidebar and collapsed sidebar (§5), and a theme switcher. `next-themes` follows the system preference until one exists.

Known gaps in Chat, where CopilotKit owns the markup: the composer is taller and rounder than §3, and its dark surface is a fixed neutral grey instead of a token.

## 9. Pre-delivery checklist

- [ ] Only semantic tokens: no hex, palette classes or arbitrary colour values
- [ ] Text is 12px or larger, and pairs meet 4.5:1 in light and dark
- [ ] Every status has an icon and a label as well as colour
- [ ] Keyboard reaches everything, in visual order, with a visible focus ring
- [ ] Controls reach 44px under `pointer: coarse`
- [ ] Only colour and opacity animate, within §4 timings
- [ ] Reduced motion leaves all content and states readable
- [ ] Works in `en` and `vi` at 375, 768, 1024 and 1440px, with no page-level horizontal scroll
- [ ] Glossary terms in UI copy: Answer, Agent, Generative UI, Organization
