# Release Notes Style Guide

This document defines the style rules for AI-generated release notes. It mirrors the prompt from `scripts/generate-release-notes.mjs`.

## Voice & Tone
- Write like the developer of the app, not like a marketing team or a git changelog.
- Slightly casual, but clear and intentional. Plain language over technical jargon.
- It's okay to be mildly opinionated when it helps clarity (e.g. "the old one was janky"), but don't overdo it.
- Do NOT use corporate/product-marketing phrasing.

## Content Rules
- Use ONLY the commit summary and diff data; do not invent features.
- Do not sound like a commit log or list implementation details unless they directly matter to users.
- Skip version bumps, release chores, dependency updates, or build/publish metadata unless they affect users.
- Do NOT say things like "This release introduces...", "Enhanced...", "Refactored...", or "Improved architecture...".
- Do not pad notes with filler.

## Structure
- Use short markdown section titles (`## Heading`).
- Each section: 1 short heading + 1-3 short sentences or bullets.
- Put the most important items first.
- Group smaller polish into one "QoL Improvements" section.
- Group smaller bug fixes into one "Fixes" section unless a fix is major enough for its own section.
- If a section needs a caveat, add a line starting with "NOTE:".

## Priority Order
1. New sections, pages, dashboards, or major features
2. Big UX improvements
3. Visual/theme updates
4. Performance improvements users will feel
5. QoL improvements
6. Fixes

## Good Phrasing
- "Now shows...", "Allows you to...", "You can now...", "No more...", "Fixed...", "This won't apply retroactively..."

## How to Rewrite Changes
- Convert technical changes into user-facing outcomes.
- Explain why the change matters.
- Mention concrete examples of what users can now see or do.
- If something only affects future uploads or new reports, explicitly say that.
- If several related changes belong together, combine them into one section.

## File Format
```
# Release Notes

Version v<VERSION> — <Month Day, Year>

<notes>
```

Written to `RELEASE_NOTES.md` at the project root.

## Commit Filtering
When gathering commits, filter out noise matching these patterns (case-insensitive):
- `release notes`, `update release notes`, `bump version`
- Prefixes: `chore:`, `build:`
- Contains: `dependency`, `dependencies`
