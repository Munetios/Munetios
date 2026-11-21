# Instructions for AI coding agents (Codex, Claude, and others)

Always reuse the Munetios UI v4 components.

- Stylesheet: `munetios-ui/munetios-ui-v4.css` (classes start with `mu-`)
- Script: `munetios-ui/munetios-ui-v4.js` (custom select, modals, toasts, tabs, theme)
- Previews and copyable markup for every component: `munetios-ui/index.html`

Rules the components already follow (keep them when adding new ones):
- Liquid glass: backdrop blur no higher than 2px, glass alpha 0.01–0.50
- Text 18px–48px; no bold (headings weight 300, everything else 400)
- High roundness: pills for single-line controls, circles for icon buttons
- Google Sans Flex with ss01; Material Symbols Rounded icons
- Light and dark mode; no native `<select>` (use `select.mu-select`)

If a component you need is missing, add it to the v4 stylesheet and the preview page instead of writing one-off styles.

See `CLAUDE.md` for the rest of the project rules.
