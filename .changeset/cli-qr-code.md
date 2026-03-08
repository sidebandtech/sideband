---
"sideband": patch
---

Print a QR code in the terminal at daemon startup alongside the Quick Connect URL.

- Renders below the URL/code block using Unicode half-block characters (`▀▄█ `) — halves
  the height vs full-size QR, works on light and dark terminals without ANSI color codes
- Skipped when the terminal is too narrow to fit the QR without line-wrapping (dynamic
  guard based on actual matrix width + 2-char left margin)
- Silently skipped on error — QR rendering never blocks startup
- Not reprinted on QC renewal (would spam the terminal); only URL + code are shown
- Zero new transitive dependencies (`qr` package, 0 deps, 7 KB gzipped)
