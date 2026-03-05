---
"@sideband/cloud": patch
---

Fix tRPC mutation request body: remove incorrect `{ json: input }` wrapper so the API call sends the input directly.
