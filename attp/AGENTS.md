# Project workflow

## Reference implementation

Treat `/Users/florentiu/bunpartener-website/` as a read-only reference project when
working on this site. Before planning or implementing a relevant frontend change,
inspect the corresponding Bun Partener page or script and extract reusable
engineering and design lessons.

Use the reference especially for:

- semantic, dependency-light static HTML/CSS/JavaScript structure;
- responsive layout, fluid typography, shared design tokens, and interaction
  states;
- navigation, scroll restoration, reveal effects, mobile behavior, and other
  progressive enhancements;
- multilingual page organization and translation-key conventions;
- accessibility, metadata, structured data, social previews, and other SEO
  details;
- privacy-conscious analytics patterns and failure-safe client-side behavior.

## Adaptation rules

1. First inspect this project's existing conventions and preserve them.
2. Compare the relevant implementation in the reference project.
3. Record or apply the underlying principle, adapted to ATTP's content, visual
   identity, architecture, and user needs.
4. Do not blindly copy markup, styling, text, branding, personal information,
   analytics identifiers, API keys, database configuration, or other
   environment-specific values.
5. Keep `/Users/florentiu/bunpartener-website/` read-only unless the user
   explicitly asks to modify that project.
6. Verify adapted work at desktop and mobile widths and check keyboard access,
   reduced-motion behavior, localization, and metadata when relevant.

The reference is a source of proven patterns, not a requirement to make the two
sites look identical.
