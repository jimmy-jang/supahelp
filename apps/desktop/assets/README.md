Supahelp's reference-based double-chevron mark and lowercase wordmark live in
`src/renderer/assets/brand`. The SVG files embed the PNG artwork, including a white variant for
dark surfaces. The name and logo are trademarks of the copyright holder and are not licensed
(see `NOTICE`).

`supahelp.png`, `.icns`, and `.ico` use the double-chevron mark on a white
square. The macOS `.icns` and `supahelp-macos.png` use a padded, rounded tile for
the app bundle and Dock. Rebuild them with `swift scripts/build-macos-icon.swift`
from `apps/desktop`. The other platforms use the original PNG and ICO.
