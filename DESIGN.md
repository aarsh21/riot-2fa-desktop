# Riot 2FA desktop

The user-pinned Vercel direction owns this redesign. Use a continuous monochrome canvas, Geist, compact controls, and a clear account ledger. No Vercel logos or claims of official authorship in this independent utility. HTML/CSS report primitives do not apply to the native GPUI renderer.

The first viewport places Accounts and Add account above a searchable ledger. Account identity anchors the left edge; six-digit codes and Copy align on the right. One shared countdown communicates the actual 30-second period. A narrow navigation rail separates accounts, requests, QR sign-in and settings. On smaller windows, navigation becomes a top row and account actions reflow beneath identity.

The signature interaction is copying a current code with an inline confirmation. Codes are hidden by default outside demo mode. Approval always names the account and request location before a deliberate confirmation. Removing an account has its own confirmation and explains that server-side 2FA remains enabled.

Use 14px body and controls, 12px subordinate context, 16px row labels, 24px section titles, and 32px page titles and codes. Regular 400, medium 500, semibold 600. Spacing uses 4, 8, 12, 16, 24, 32 and 40px. Controls have a 6px radius. No decorative motion, gradients, shadows or nested cards. Light and dark follow system appearance, with explicit environment overrides only for testing.

Keep native titlebars and OS window controls. Inputs and action targets participate in keyboard focus. GPUIx currently has no public accessibility-role API; do not claim screen-reader parity. Secret inputs cannot use native password masking in the pinned renderer, so warn directly beside the manual-entry field. Never include real account records in review captures.
