# Primer Design Token Guidelines

> Metadata: This file is a Dictionary of tokens. For usage rules, contrast requirements, and motion logic, refer to DESIGN_TOKENS_GUIDE.md.

Reference for using GitHub Primer design tokens.

## Legend

- **U:** Use cases
- **R:** Token-specific rules (see Semantic Key for general meaning)
- **emphasis** variant: Strong/prominent version, use `fg.onEmphasis` for text
- **muted** variant: Subtle version, use matching `fg.*` color for text
- **[a, b]** Bracket notation groups related tokens

## Semantic Key

These semantic meanings apply across all token types (bgColor, borderColor, fgColor, border).

| Semantic | Meaning | Example Usage | Text Pairing |
|---|---|---|---|
| **danger** | Errors, destructive actions, critical warnings | delete buttons, error messages, validation errors | fg.danger (muted bg) or fg.onEmphasis (emphasis bg) |
| **success** | Positive states, confirmations, completed actions | merge buttons, success messages, confirmations | fg.success (muted bg) or fg.onEmphasis (emphasis bg) |
| **attention** | Warnings, caution states requiring user awareness | warning banners, caution labels, pending states | fg.attention (muted bg) or fg.default (emphasis bg, due to yellow contrast) |
| **severe** | High-priority warnings, more urgent than attention | urgent messages, escalations, high-priority indicators | fg.severe (muted bg) or fg.onEmphasis (emphasis bg) |
| **accent** | Selected, focused, or highlighted interactive elements | active states, selected rows, focus indicators | fg.accent (muted bg) or fg.onEmphasis (emphasis bg) |
| **neutral** | Non-semantic, secondary UI elements | secondary buttons, tags, labels without status meaning | fg.default (muted bg) or fg.onEmphasis (emphasis bg) |
| **open** | Open/active state indicators (GitHub issues, PRs) | open issues, open PRs, active discussions | fg.open (muted bg) or fg.onEmphasis (emphasis bg) |
| **closed** | Closed/declined state indicators (GitHub issues, PRs) | closed issues, closed PRs, declined items | fg.closed (muted bg) or fg.onEmphasis (emphasis bg) |
| **done** | Completed/merged state indicators | merged PRs, completed tasks, finished items | fg.done (muted bg) or fg.onEmphasis (emphasis bg) |
| **sponsors** | GitHub Sponsors content only | sponsor buttons, funding prompts, sponsor cards | fg.sponsors (muted bg) or fg.onEmphasis (emphasis bg) |
| **upsell** | Upgrade prompts, premium features, promotional content | upgrade buttons, premium badges, promotional banners | fg.upsell (muted bg) or fg.onEmphasis (emphasis bg) |

## Background Colors

Background color tokens for surfaces, containers, and UI elements.

**Semantic tokens** (see Semantic Key for meaning):
- `bgColor-[accent, attention, closed, danger, done, neutral, open, severe, sponsors, success, upsell]-emphasis`
- `bgColor-[accent, attention, closed, danger, done, neutral, open, severe, sponsors, success, upsell]-muted`

### bgColor-black
Pure black background
**R:** Avoid using raw black. Use semantic alternatives: bg.emphasis for dark backgrounds, bg.inverse for inverted contexts. Raw black/white ignore theme preferences and accessibility settings.

### bgColor-default
Default background color for pages and main content areas
**U:** card-background, main-content, page-background
**R:** Use as the primary background for pages and content areas. Do NOT use for emphasis or highlighting.

### bgColor-disabled
Background for disabled interactive elements
**U:** disabled-button, disabled-input, inactive-element
**R:** MUST use for disabled state backgrounds. Pair -> fg.disabled for text. Do NOT use for active elements.

### bgColor-draft-emphasis
Strong background for draft state badges and labels
**U:** draft-badge, draft-label, wip-indicator
**R:** Use for prominent draft state indicators. Pair -> fg.onEmphasis for text.

### bgColor-draft-muted
Subtle background for draft state indicators
**U:** draft-issue, draft-pr, work-in-progress
**R:** Use for draft/WIP status indicators. Conveys incomplete or pending state.

### bgColor-emphasis
High-emphasis dark background for strong visual contrast
**U:** badge-background, high-contrast-element, tooltip
**R:** Use for elements needing strong visual emphasis. Pair -> fg.onEmphasis for text. Do NOT use for large areas.

### bgColor-inset
Inset background for recessed content areas like wells or sunken panels
**U:** recessed-area, sunken-panel, well
**R:** Use for visually recessed areas. Creates depth hierarchy. Suitable for input fields and wells.

### bgColor-inverse
Inverse background that flips between light and dark modes
**U:** inverse-theme-element, overlay-content
**R:** Use when you need opposite theme background. Pair -> fg.onInverse for text.

### bgColor-muted
Muted background for secondary content areas and subtle grouping
**U:** code-block-background, secondary-content, table-header
**R:** Use for secondary content areas or to create visual grouping. Do NOT use for primary page backgrounds.

### bgColor-transparent
Fully transparent background
**U:** ghost-button, icon-button, overlay-trigger
**R:** Use for ghost/icon buttons or when element should blend with parent. Ensure sufficient contrast for interactive states.

### bgColor-white
Pure white background
**R:** Avoid using raw white. Use semantic alternatives: bg.default for standard backgrounds, bg.inset for recessed areas, or bg.inverse for inverted contexts. Raw black/white ignore theme preferences and accessibility settings.

## Border

Composite border tokens combining color, width, and style.

**Semantic tokens** (see Semantic Key for meaning):
- `border-[accent, attention, closed, danger, done, neutral, open, severe, sponsors, success, upsell]-emphasis`
- `border-[accent, attention, closed, danger, done, neutral, open, severe, sponsors, success, upsell]-muted`

**Tokens:** border-default, border-disabled, border-emphasis, border-muted, border-transparent

### draft
**Tokens:** border-draft-emphasis, border-draft-muted

### border-translucent
Semi-transparent border shorthand for overlays and layered elements. Border-specific token — no bgColor-translucent counterpart exists by design.

## Border Colors

Border color tokens for boundaries, dividers, and outlines.

**Semantic tokens** (see Semantic Key for meaning):
- `borderColor-[accent, attention, closed, danger, done, neutral, open, severe, sponsors, success, upsell]-emphasis`
- `borderColor-[accent, attention, closed, danger, done, neutral, open, severe, sponsors, success, upsell]-muted`

### borderColor-default
Default border color for most UI elements
**U:** card-border, default-border, input-border
**R:** RECOMMENDED default for all borders. Use for cards, inputs, and dividers.

### borderColor-disabled
Border color for disabled interactive elements
**U:** disabled-border, inactive-border, unavailable
**R:** MUST use for disabled state borders. Pair -> bg.disabled. Do NOT use for active elements.

### borderColor-draft-emphasis
Strong border for draft state badges
**U:** draft-emphasis, draft-status
**R:** Use for emphasized draft state borders. Pair -> bg.draft.emphasis.

### borderColor-draft-muted
Subtle border for draft state indicators
**U:** draft-issue, draft-muted, draft-pr
**R:** Use for draft/WIP status borders. Conveys incomplete or pending state.

### borderColor-emphasis
Strong border for emphasis and visual weight
**U:** emphasis-border, selected-border, strong-border
**R:** Use for borders needing more visual weight. Darker than border.default.

### borderColor-muted
Subtle border for secondary elements and light separators
**U:** light-divider, secondary-border, subtle-border
**R:** Use for subtle borders and separators. Less prominent than border.default.

### borderColor-translucent
Semi-transparent border for overlays and layered elements. Border-specific token — no bgColor-translucent counterpart exists by design.
**U:** overlay-border, translucent-border
**R:** Use for semi-transparent borders on overlays. Works well with translucent backgrounds.

### borderColor-transparent
Fully transparent border
**U:** border-color, border-styling
**R:** These are COLOR-ONLY tokens (resolve to a hex value like #cf222e). Use for the CSS `border-color` property. Do NOT use for the CSS `border` shorthand — use border.* tokens instead.

## Border Radius

Corner radius tokens for rounded elements.

### borderRadius-full
Use this border radius for pill shaped elements
**U:** avatar, circular-button, pill-badge
**R:** Use for avatars and pill-shaped elements. Do NOT use for rectangular containers.

### borderRadius-large
Large border radius (12px). Use for larger containers, dialogs, or when more visual softness is desired.
**U:** card, dialog, modal
**R:** Recommended for dialogs and modals.

### borderRadius-medium
Medium border radius (6px). The default choice for most buttons, cards, and containers
**U:** button, input, textarea
**R:** Default choice for most components. Use for inputs, cards, and general containers.

### borderRadius-small
Small border radius (3px). Use for small variants of components or small UI elements like badges, tags, or anything below 16px in height
**U:** badge, label, tag
**R:** Use for small UI elements under 16px height. Do NOT use for buttons or cards.

## Border Width

Border thickness tokens.

### borderWidth-thick
Thick 2px border for emphasis. Use for focus indicators, selected states, or to emphasize important boundaries
**U:** emphasis-border, focus-indicator, selected-state
**R:** MUST use for focus rings on interactive elements. Do NOT use for subtle dividers.

## Color
### ANSI Terminal Colors

ANSI terminal color palette for command-line interfaces and terminal emulators. Maps standard ANSI color names to theme-appropriate values.

**U:** terminal-output, cli-interface, console-text
**R:** Use exclusively for terminal/CLI contexts. Do NOT use for general UI—use semantic colors (fgColor, bgColor) instead. These colors follow ANSI naming conventions (black, red, green, yellow, blue, magenta, cyan, white) with bright variants.

**Pattern:** `color-ansi-[color]` or `color-ansi-[color]-bright`

**Variables:**
- **color:** black | red | green | yellow | blue | magenta | cyan | white | gray
- **variant:** default (no suffix) | bright

### Syntax Highlighting (prettylights)

Syntax highlighting colors for code display. Used by GitHub code rendering (prettylights theme).

**U:** code-syntax-highlighting, code-block, inline-code
**R:** Use exclusively for syntax highlighting in code display contexts. Do NOT use for general UI text or backgrounds. Each token maps to a specific syntax element (comment, keyword, string, etc.).

**Pattern:** `color-prettylights-syntax-[element]`

**Core elements:** comment, constant, entity, keyword, string, variable

**Compound elements:**
- `brackethighlighter-[angle, unmatched]`
- `carriage-[return]-[bg, text]`
- `constant-[other-reference-link]`
- `entity-[tag]`
- `invalid-[illegal]-[bg, text]`
- `markup-[bold, heading, italic, list]`
- `markup-[changed, deleted, ignored, inserted]-[bg, text]`
- `meta-[diff-range]`
- `storage-[modifier-import]`
- `string-[regexp]`
- `sublimelinter-[gutter-mark]`

## Controls

Tokens for interactive controls like buttons, inputs, and selects.

**Scale:** Use xsmall/small for dense layouts, medium for default UI, large/xlarge for prominent CTAs.

**Size patterns:**
- `control-[xsmall, small, medium, large, xlarge]-[gap, lineBoxHeight, paddingBlock, paddingInline-condensed, paddingInline-normal, paddingInline-spacious, size]`

**State variants:**
- `control-checked-[bgColor-active, bgColor-disabled, bgColor-hover, bgColor-rest, borderColor-active, borderColor-disabled, borderColor-hover, borderColor-rest, fgColor-disabled, fgColor-rest]`
- `control-transparent-[bgColor-active, bgColor-disabled, bgColor-hover, bgColor-rest, bgColor-selected, borderColor-active, borderColor-hover, borderColor-rest]`

**Other tokens:**
- `control-bgColor-[active, disabled, hover, rest, selected]`
- `control-borderColor-[danger, disabled, emphasis, rest, selected, success, warning]`
- `control-danger-bgColor-[active, hover]`
- `control-danger-fgColor-[hover, rest]`
- `control-fgColor-[disabled, placeholder, rest]`
- `control-iconColor-rest`
- `control-minTarget-[auto, coarse, fine]`

## Control Knob

Colors for toggle switch knobs (the circular handle that moves along the track).

**U:** slider-thumb, switch-handle, toggle-knob
**R:** Use for the movable handle/thumb of toggle switches and sliders. Pair -> controlTrack tokens for the background rail.

**Tokens:** controlKnob-bgColor-checked, controlKnob-bgColor-disabled, controlKnob-bgColor-rest, controlKnob-borderColor-checked, controlKnob-borderColor-disabled, controlKnob-borderColor-rest

## Control Stack

Gap tokens for groups of controls arranged in a row or column.

**Scale:** Match gap size to control size. Use condensed for tight groupings, spacious for separated actions.

**Size patterns:**
- `controlStack-[small, medium, large]-[gap-auto, gap-condensed, gap-spacious]`

## Control Track

Colors for toggle switch tracks (the background rail that the knob slides along).

**U:** slider-track, switch-track, toggle-track
**R:** Use for the track/rail element of toggle switches and sliders. Pair -> controlKnob tokens for the movable handle.

**Tokens:** controlTrack-bgColor-active, controlTrack-bgColor-disabled, controlTrack-bgColor-hover, controlTrack-bgColor-rest, controlTrack-borderColor-disabled, controlTrack-borderColor-rest, controlTrack-fgColor-disabled, controlTrack-fgColor-rest

## Data Visualization

Color tokens for charts, graphs, and diagrams. Use emphasis variants for lines/bars, muted variants for fills.

**U:** chart-series, graph-line, bar-fill
**R:** Use data colors for visualizations only. Do NOT use for semantic meaning (use bg.success/danger instead). When using multiple series, ensure sufficient contrast between adjacent colors. Pair emphasis with muted variants of the same color for cohesive styling.

**Pattern:** `data-[color]-color-[variant]`

**Variables:**
- **color:** auburn | blue | brown | coral | gray | green | lemon | lime | olive | orange | pine | pink | plum | purple | red | teal | yellow
- **variant:** emphasis | muted

**Variant usage:**
- **emphasis:** Lines, bars, borders, data points
- **muted:** Area fills, backgrounds, subtle regions

*Pair emphasis with muted variants of the same color for cohesive chart styling.*

## Display Colors

Decorative colors for categorization without semantic meaning. Use for labels, tags, avatars, and user-assigned colors. Do NOT use for success/error/warning—use semantic colors instead.

**U:** label, tag, avatar
**R:** Use display colors for arbitrary categorization where the color has no inherent meaning (e.g., project labels, user avatars). For meaningful states like success, error, or warning, use semantic colors instead. Scales 0-2 are lighter (backgrounds), 3-5 are mid-tones, 6-9 are darker (foregrounds/borders).

**Pattern:** `display-[color]-[property]`

**Variables:**
- **color:** auburn | blue | brown | coral | cyan | gray | green | indigo | lemon | lime | olive | orange | pine | pink | plum | purple | red | teal | yellow
- **property:** bgColor-emphasis | bgColor-muted | borderColor-emphasis | borderColor-muted | fgColor

**Scale pattern:** `display-[color]-scale-[n]`
- **n:** 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

*Scale 0-2: lighter (backgrounds), 3-5: mid-tones, 6-9: darker (foregrounds/borders)*

## Easing

Animation easing function tokens.

### base-easing-ease
CSS default easing. Use for hover state changes and micro-interactions.
**U:** button-hover, hover-state, micro-interaction
**R:** Use for hover state changes.

### base-easing-easeIn
Accelerating motion. Use for elements exiting the viewport (moving off-screen).
**U:** element-leaving, exit-animation, off-screen-motion
**R:** Rarely used alone. Prefer ease-out for most exit animations.

### base-easing-easeInOut
Smooth acceleration and deceleration. Use for elements moving or morphing within the viewport.
**U:** morph-animation, position-change, size-change
**R:** Use if an element moves or morphs on screen.

### base-easing-easeOut
Decelerating motion. Use for elements entering the viewport or appearing on screen.
**U:** element-appearing, enter-animation, modal-open
**R:** RECOMMENDED default. Use if an element enters or exits the viewport.

### base-easing-linear
Constant motion with no acceleration. Use for continuous animations like progress bars or loaders.
**U:** continuous-animation, loader, progress-bar
**R:** Use if the motion is constant.

## Foreground Colors

Text and icon color tokens.

**Semantic tokens** (see Semantic Key for meaning):
- `fgColor-[accent, attention, closed, danger, done, neutral, open, severe, sponsors, success, upsell]`

### fgColor-black
Pure black text
**R:** Avoid using raw black. Use semantic alternatives: fg.default for standard text, fg.muted for secondary text. Raw black/white ignore theme preferences and accessibility settings.

### fgColor-default
Default text color for primary content and headings
**U:** body-text, default-text, heading
**R:** RECOMMENDED default for all text. Use for headings, body text, and primary labels.

### fgColor-disabled
Text color for disabled interactive elements
**U:** disabled-text, inactive-text, unavailable
**R:** MUST use for disabled state text. Pair -> bg.disabled. Do NOT use for active elements.

### fgColor-draft
Text color for draft state indicators
**U:** draft-issue, draft-pr, draft-text
**R:** Use for draft/WIP status text. Conveys incomplete or pending state.

### fgColor-link
Text color for hyperlinks
**U:** hyperlink, link-text
**R:** MUST use for all text links. Provides expected link affordance.

### fgColor-muted
Muted text for secondary content and less important information
**U:** helper-text, muted-text, secondary-text
**R:** Use for secondary text like timestamps, metadata, and helper text. Do NOT use for primary content.

### fgColor-onEmphasis
Text color for use on emphasis backgrounds
**U:** contrast-text, text-on-emphasis
**R:** MUST use for text on any emphasis background (bg.*.emphasis). Ensures accessibility contrast.

### fgColor-onInverse
Text color for use on inverse backgrounds
**U:** inverse-text, text-on-inverse
**R:** Use for text on bg.inverse. Provides appropriate contrast in both themes.

### fgColor-white
Pure white text
**R:** Avoid using raw white. Use semantic alternatives: fg.onEmphasis for text on dark backgrounds, fg.onInverse for inverted contexts. Raw black/white ignore theme preferences and accessibility settings.

## Focus

Focus ring and outline tokens for keyboard navigation accessibility.

### focus-outline
Focus ring outline for keyboard navigation and accessibility.
**U:** accessibility-indicator, focus-ring, keyboard-navigation
**R:** Always ensure focus states are visible. Do not override with custom focus styles that reduce visibility. Use for interactive elements like buttons, links, and form controls.

### focus-outlineColor
Outline color for focus states on interactive elements
**U:** accessibility-indicator, focus-ring, keyboard-navigation
**R:** Use for focus outlines on interactive elements like buttons, links, and form controls. MUST be visible for keyboard navigation accessibility. Do NOT use for decorative borders or non-interactive elements.

## Font Stacks

Font family tokens.

### fontStack-monospace
Monospace font stack for code, technical content, and tabular data.
**U:** code-block, inline-code, terminal
**R:** MUST use for all code display. Use for technical content requiring fixed-width characters.

### fontStack-sansSerif
Sans-serif font stack for body text and general UI elements.
**U:** body-text, form-inputs, labels
**R:** Default font stack for all UI text. Use for body text and standard UI elements. MUST use for readable content.

### fontStack-sansSerifDisplay
Display font stack for headings and titles. Same as sansSerif but semantically distinct.
**U:** display-text, heading, title
**R:** Use for headings and display text. Prefer over sansSerif for titles.

## Outline

Outline tokens for focus indicators.

### outline-focus-width
Focus outline width (2px). Standard width for keyboard focus indicators to meet WCAG 2.4.7 accessibility requirements
**U:** accessibility, focus-ring, keyboard-focus
**R:** MUST use for all keyboard focus indicators. Required for WCAG 2.4.7 compliance.

## Overlay

Tokens for modals, dialogs, popovers, and dropdown menus.

**Scale:** Use xsmall/small for menus and tooltips, medium for dialogs, large/xlarge for complex modals or sheets.

**Size patterns:**
- `overlay-height-[small, medium, large, xlarge]`
- `overlay-width-[xsmall, small, medium, large, xlarge]`

**Other tokens:**
- `overlay-backdrop-bgColor`
- `overlay-bgColor-default`
- `overlay-borderColor-default`
- `overlay-borderRadius-default`
- `overlay-offset-default`
- `overlay-padding-[condensed, normal]`
- `overlay-paddingBlock-[condensed, normal]`

## Selection

Tokens for text selection highlights.

### selection-bgColor
Background color for text selection highlights
**U:** highlighted-text, selected-content, text-selection
**R:** Use for native text selection (::selection) and programmatic text highlighting. Do NOT use for general emphasis or background colors on containers.

## Shadow

Box shadow tokens for elevation and depth.

### shadow-floating-large
Large floating shadow for modals and dialogs
**U:** dialog, full-screen-overlay, modal
**R:** MUST use for modals and dialogs. Do NOT use for small floating elements.

### shadow-floating-legacy
Legacy floating shadow for backward compatibility
**U:** backward-compatibility, legacy-component
**R:** DEPRECATED: Use shadow-floating-small instead. Only use for maintaining backward compatibility with existing implementations.

### shadow-floating-medium
Medium floating shadow for popovers and action menus
**U:** action-menu, popover, select-panel
**R:** Use for medium-sized floating elements like popovers and action menus. More prominent than small but less than dialogs. Do NOT use for full modals.

### shadow-floating-small
Small floating shadow for dropdowns, tooltips, and small overlays
**U:** dropdown, popover, tooltip
**R:** Use for small floating elements like dropdowns and tooltips. Do NOT use for modals or dialogs.

### shadow-floating-xlarge
Extra large floating shadow for full-screen overlays and sheets
**U:** drawer, full-screen-overlay, side-sheet
**R:** Use for full-screen or near-full-screen overlays like side sheets and drawers. Maximum elevation in the system. Do NOT use for small floating elements.

### shadow-inset
Inset shadow for recessed elements
**U:** input-field, pressed-button, recessed-area
**R:** Use for elements that appear pressed or inset into the surface. Commonly used for input fields and wells. Do NOT use for floating elements.

### shadow-resting-medium
Medium resting shadow for cards and elevated surfaces
**U:** card, elevated-surface, panel
**R:** Use for cards and content panels that sit above the page surface. Provides moderate elevation without appearing to float. Do NOT use for overlays or modals.

### shadow-resting-small
Small resting shadow for buttons and interactive elements
**U:** button, clickable-element, interactive-card
**R:** Use for buttons and small interactive elements at rest. Provides subtle depth and clickable affordance. RECOMMENDED for default button shadows.

### shadow-resting-xsmall
Extra small resting shadow for minimal elevation
**U:** badge, chip, small-card
**R:** Use for very subtle elevation on small elements. Provides minimal lift from surface. Do NOT use for interactive elements needing clear affordance.

## Spinner

Loading spinner size and stroke tokens.

**Scale:** Use small for inline loading, medium for buttons/cards, large for full-page states.

**Size patterns:**
- `spinner-size-[small, medium, large]`

**Other tokens:**
- `spinner-strokeWidth-default`

## Stack

Spacing tokens for Stack layout components.

**Scale:** Use condensed for dense lists, normal for standard layouts, spacious for prominent sections.

**Other tokens:**
- `stack-gap-[condensed, normal, spacious]`
- `stack-padding-[condensed, normal, spacious]`

## Typography

Text style shorthand tokens for consistent typography across the UI.

### Headings

Title and display text styles for headings and hero sections.

| Token | Description | U: | R: |
|---|---|---|---|
| **text-display-shorthand** | Hero-style text for brand to product transition pages. Utilize Title (large) styles on narrow viewports. | hero-section, landing-page, marketing-header | Use sparingly for hero sections. Switch to title.large on narrow viewports. |
| **text-subtitle-shorthand** | Page sections/sub headings, or less important object names in page titles (automated action titles, for example). Same line-height as title (medium). | subtitle, description, secondary-heading | Use below titles for supporting text. Normal weight distinguishes from title styles. |
| **text-title-shorthand-large** | Page headings for user-created objects, such as issues or pull requests. Utilize title (medium) styles on narrow viewports. | page-heading, issue-title, pr-title | Use for primary page headings. Switch to title.medium on narrow viewports. |
| **text-title-shorthand-medium** | Default page title. The 32px-equivalent line-height matches with button and other medium control heights. Great for page header composition. | section-heading, card-title, dialog-title | RECOMMENDED default for page titles. Use for section headings and dialog titles. |
| **text-title-shorthand-small** | Uses the same size as body (large) with a heavier weight of semibold (600). | subsection-heading, list-title, h3 | Use for smaller headings within sections. Same size as body.large but semibold. |

### Body

Body text and caption styles for content and UI labels.

| Token | Description | U: | R: |
|---|---|---|---|
| **text-body-shorthand-large** | User-generated content, markdown rendering. | markdown-content, article-text, readme | Use for user-generated content and markdown. Better readability for longer text. |
| **text-body-shorthand-medium** | Default UI font. Most commonly used for body text. | body-text, ui-text, form-label | RECOMMENDED default for UI text. Use for buttons, labels, and general interface text. |
| **text-body-shorthand-small** | Small body text for discrete UI applications, such as helper, footnote text. Should be used sparingly across pages. Line-height matches Body (medium) at 20px. | helper-text, footnote, metadata | Use sparingly for secondary information. Do NOT use for primary content or interactive elements. |
| **text-caption-shorthand** | Compact small font with a smaller line height of 16px. Use it for single-line scenarios, as the small sizing doesn’t pass accessibility requirements. | caption, label, badge-text | Use only for single-line or short text. Does NOT meet accessibility requirements for body text. |

### Code

Monospace text styles for code blocks and inline code.

| Token | Description | U: | R: |
|---|---|---|---|
| **text-codeBlock-shorthand** | Default style for rendering code blocks. | code-block, pre-element, code-snippet | MUST use for multi-line code. Use monospace font stack. |
| **text-codeInline-shorthand** | Inline code blocks using em units to inherit size from its parent. | inline-code, code-element, variable-name | Use for inline code within text. Size inherits from parent using em units. |

## ZIndex

### zIndex-behind
Place element behind base content. Use for decorative backgrounds or canvas elements.
**U:** background-pattern, canvas-element, decorative-background
**R:** Use to push an element behind its siblings. WARNING: Negative z-index can behave unpredictably if any ancestor creates a new stacking context (via transform, opacity < 1, filter, will-change, etc.). Only use when you control the full stacking context chain. Do NOT use as a general "hide" mechanism.

### zIndex-default
Default stacking order. No elevation above surrounding content.
**U:** default-content, in-flow-element, reset
**R:** Use to explicitly reset z-index to the default layer. Suitable for elements that should participate in normal document flow stacking. Do NOT use for any element that needs to appear above other content.

### zIndex-dropdown
Dropdown menus and select panels that appear above page content.
**U:** autocomplete-list, dropdown-menu, select-panel
**R:** Use for menus, select panels, and autocomplete lists that overlay page content. These should appear above sticky elements but below overlays and modals. Pair -> `shadow.floating.small` or `shadow.floating.medium` for visual elevation.

### zIndex-modal
Modal dialogs and full-screen overlays.
**U:** dialog, full-screen-overlay, modal-dialog
**R:** Use for modal dialogs that require user interaction before returning to the page. MUST trap focus within the modal. MUST appear above all other page content except popovers and skip links. Pair -> `shadow.floating.large` or `shadow.floating.xlarge` for visual elevation.

### zIndex-overlay
Overlay backdrops, side panels, and drawers.
**U:** drawer, overlay-backdrop, side-panel
**R:** Use for overlay surfaces that partially cover the page — drawers, side panels, and backdrop layers. These appear above dropdowns but below modal dialogs. SHOULD be paired with a backdrop/scrim element to indicate the overlay is blocking interaction with content beneath.

### zIndex-popover
Tooltips and popovers that appear above all normal UI.
**U:** hover-card, popover, tooltip
**R:** Use for tooltips, popovers, and hover cards that must appear above all other UI elements including modals. These are the highest layer in normal UI. Do NOT use for persistent navigation — use `sticky` instead.

### zIndex-skipLink
Accessibility skip links. Must always be the topmost layer.
**U:** skip-link, skip-navigation, skip-to-content
**R:** MUST use for accessibility skip links that allow keyboard users to bypass navigation. This is the highest z-index level and MUST always appear above everything else including modals and tooltips. NEVER use for non-accessibility purposes.

### zIndex-sticky
Sticky elements that remain visible while scrolling.
**U:** sticky-header, sticky-sidebar, sticky-table-header
**R:** MUST use with `position: sticky` or `position: fixed` for headers, sidebars, and navigation bars that persist during scroll. Do NOT use for floating overlays or dropdowns — use higher z-index levels instead.

---

**Final Directive for AI**:
Always cross-reference the `Semantic Key` at the top of this SPEC before confirming a token choice. If a specific component token is missing, derive it using the `[category]-[semantic]-[variant]` pattern.