// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Configuration } from "lint-staged";

export default {
  "*.{ts,tsx,js,jsx}": ["prettier --write", () => "tsc --noEmit"],
  "*.{json,md}": ["prettier --write"],
} satisfies Configuration;
