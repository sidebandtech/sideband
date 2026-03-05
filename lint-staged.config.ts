import type { Configuration } from "lint-staged";

export default {
  // Function prevents lint-staged from appending staged filenames to tsc.
  "*.{ts,tsx,js,jsx}": [
    "prettier --write",
    () => "tsc --build tsconfig.check.json",
  ],
  "*.{json,md}": ["prettier --write"],
} satisfies Configuration;
