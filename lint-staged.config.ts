import type { Configuration } from "lint-staged";

export default {
  "*.{ts,tsx,js,jsx}": [
    "eslint --fix",
    "prettier --write",
    // Function prevents lint-staged from appending staged filenames to tsc.
    () => "tsc --build tsconfig.check.json",
  ],
  "*.{json,md}": ["prettier --write"],
} satisfies Configuration;
