---
"@conciergeprotocol/server": minor
---

Add `currentAccount`. It reads the site's own session from the request, so a person who is already signed in approves a login or a held action with one click instead of typing a password. Signed-in approvals require a SameSite=Strict form cookie from the same site.
