# theme

`/theme`: opens Pi's own theme picker, the one `/settings` uses. Spec:
[#36](https://github.com/aakshintala/pi-rig/issues/36).

- Moving through the list previews each theme in memory.
- Enter applies the theme; Pi saves it to `settings.json` itself.
- Esc restores Pi's exact prior state and saves nothing: the theme, its file
  watcher and automatic light/dark switching are untouched.
- Preview swaps the active theme on the global Pi's theme module reads, the
  way Pi's own picker previews. It runs only when that global holds the live
  theme (checked against the active theme, so a renamed slot degrades to no
  preview). Otherwise `/theme` has no live
  preview: moving only moves the cursor, Esc changes nothing, and Enter still
  applies the theme through Pi.
- Without the TUI, `/theme` says so.

## Tools and settings

None.

## Upstream

Replaces [`pi-theme-picker`](https://github.com/ldelossa/pi-theme-picker)
0.1.2 (MIT). No code was copied: the picker is Pi's exported
`ThemeSelectorComponent`, so there is no second picker and no write to
`settings.json` behind Pi's back.
