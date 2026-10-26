# GeeLark Ops V4 — Profile manager + daily redirect reports

**Upgrade for the existing `tiktok-netlify-rotator` project.** Keep your existing Netlify project, GitHub repo, Upstash Redis database, and environment variables. This upgrade changes the admin experience and backend storage without requiring a new database.

## Features

- Automatic GeeLark profile number + TikTok Pro URL pairing from pasted text (including numbered/Markdown messages, copied TikTok preview text and escaped URLs).
- **One destination per GeeLark profile.** Different profiles may point to an identical destination; the dashboard warns you about duplicates. Rotation and counts are per **profile ID**, not per URL.
- Individually enable/pause any profile, or bulk enable/pause selected profiles. Active profiles take turns receiving redirects through a Redis-atomic round-robin counter.
- A **Done today** checkbox to the left of each profile ID. Its display automatically clears when the date changes in **America/New_York** (EST in winter / EDT in summer). No midnight cron required. The browser refreshes while the dashboard is open.
- Editable per-profile whole-number point balances; a **Record $50 claim** action deducts exactly **750,000** points once per New York calendar day, provided enough points remain. An **Undo today's claim** button restores the points and reverses the claim bookkeeping entry.
- Per-profile redirects **today and all-time**, plus a new **Daily redirect stats** workspace that reports by New York calendar date, GeeLark profile number, and actual TikTok destination URL.
- Daily reports support selectable **7, 14, 30, and 90-day windows**, a historical **ending date**, day-by-day charts, per-day drilldowns, profile/URL search and **CSV export with one row per date + profile + URL**.
- New redirect assignments record a snapshot of the **exact destination URL in use at that moment**, so editing a profile's URL will not rewrite its older URL-level history.
- Daily profile statistics recorded by the prior V3 version remain available. Earlier days without URL snapshots appear as **"URL not recorded"** rather than being incorrectly credited to the current URL.
- Total/claimed-today counts, all-time claim value, recent claim/import audit, search/filter, profile CSV export and JSON backup.
- Existing Netlify admin secret (`ADMIN_KEY`) required to use the management API. Redis REST credentials are never sent to browsers. No external libraries or analytics required.

**Important:** These numbers track server-issued HTTP redirects and your *manual* account/reward bookkeeping, not TikTok impressions, qualification, coins, conversions, accepted referrals, or actual gift-card redemptions.

## Daily statistics workflow

1. In the admin panel, open **Daily redirect stats** in the left navigation.
2. Pick a **7, 14, 30 or 90 day** reporting period and a **through date (ET)**. Click **Apply dates**.
3. Inspect the daily chart and table of dates. Click **View breakdown** on any day to see the GeeLark profile number, **exact destination URL** at redirect time, and assigned redirects.
4. Type a profile number or link fragment in the breakdown search box to narrow the daily report.
5. Click **Export daily CSV** for all the day/profile/URL rows in the selected period. The CSV can be opened with Excel/Numbers.
6. In **Profiles & links**, click **View daily** on a profile row to open its daily report.

- All report calendar boundaries use `America/New_York`, adjusting EST/EDT automatically.
- Redis stores profile and destination-link daily counters separately and updates them atomically with the round-robin redirect. They are retained **up to 400 days from the last write of each day key**, rather than the prior 95-day setting. The dashboard allows choosing an ending date within the past 365 days, with up to 90 days per view.
- No retroactive link attribution is possible: prior **V3** per-profile/day data is preserved, but accurate *per-link* daily tracking begins **only after deploying V4**. Historical daily data beyond its original retention may already have expired.
- These are **redirect assignments issued** by your Netlify Function, not guaranteed site landings, unique visitors, TikTok-accepted referrals or rewards.
- Changing the active state of a profile doesn't delete history. Replacing its URL doesn't rewrite old snapshots. If you assign the same destination to two profiles, each profile's counts remain separate.

## Existing-site upgrade on a Mac

Your current repository layout has a nested **`tiktok-netlify-rotator/`** directory. Netlify Base directory is already set to `tiktok-netlify-rotator`.

1. Download this ZIP and extract it by double-clicking in Finder.
2. Recommended: install **GitHub Desktop**, clone your existing GitHub repository and open its folder in Finder.
3. Open the clone's `tiktok-netlify-rotator` subfolder. **Copy the CONTENTS of the extracted ZIP into that existing subfolder.** Choose *Replace* for duplicates. **Do not create another inner folder.**
4. In the old folder, delete the outdated functions `netlify/functions/links.mjs`, `stats.mjs` and `_redis.mjs` if they still exist; this prevents their old endpoints from lingering. The functions are `_core.mjs`, `admin.mjs` and `rotate.mjs` (all three are updated in V4).
5. Commit and push to the existing GitHub repository. Netlify automatically creates a new deploy.
6. **Do not change** the known-working Netlify Build settings: Base `tiktok-netlify-rotator`, Publish `public`, Functions `netlify/functions`, Build command blank. Package directory can remain auto-filled.
7. **Do not replace** your Redis credentials or `ADMIN_KEY`. The project uses `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and `ADMIN_KEY` from your existing Netlify environment variables.
8. When Netlify shows **Published**, open `https://YOUR-SITE.netlify.app/admin` and enter the `ADMIN_KEY`. Choose **Daily redirect stats** for daily charts, individual destination URL counts and CSV export. `/dashboard.html` opens the new manager.
9. Choose **Import profiles**, paste your text, click **Preview parsed profiles**, then select **Replace active rotation** and save. This is especially important if your older site already had unnumbered links: old entries will be paused, NOT deleted.

Do NOT merely upload the ZIP as one file to GitHub. GitHub web upload also may not reliably overwrite nested files; GitHub Desktop is recommended for a full upgrade.

## Example pasted input

```text
1. 235 [https://pro.tiktok.com/t/ZT9ydrrQMqPyg-iRKcl/](https://pro.tiktok.com/t/ZT9ydrrQMqPyg-iRKcl/)
233 Don't miss out on rewards! Scan the QR code to unlock rewards now! https://pro.tiktok.com/t/ZT9ydrcUWvTo7-8aDKj/
234 https://pro.tiktok.com/t/ZP9ydh1Qwpw19-bUliE/
196 https://pro.tiktok.com/t/ZP9UnfLEJax1g-O8ZCa/
195 https://pro.tiktok.com/t/ZP9UnfLEJax1g-O8ZCa/
```

The parser assigns URLs to `235`, `233`, `234`, `196`, `195`, not the outer list number `1.`. It warns that `196` and `195` share a destination but **retains both profiles**. This is correct if they really do have the same link.

- **Merge:** add/update listed profiles; keep all other profiles' current active state.
- **Replace active rotation:** add/update and enable all listed profiles; turn OFF all unlisted profiles, without losing their points, claim history or redirect counts.
- Editing an existing profile's URL leaves that profile's recorded traffic and claims attached to its GeeLark ID.
- Each profile can be marked completed for the day independently of recording its $50 claim.

## Compatibility and historical statistics

On the first request, the new app initializes the new `tiktok-rotator:v3:*` keys using the previous active link list in Redis (`tiktok-rotator:live-links`) when present. Since historical URLs did not identify GeeLark profile numbers, these are carried over as `legacy-001`, `legacy-002`, etc. Historical per-URL redirect counts remain visible as an **aggregate legacy total** but **cannot be attributed reliably to new GeeLark IDs**. New per-profile counts begin at zero after upgrading.

Old data is not overwritten or deleted. The new system uses the existing database but its own `v3` keys. When switching to numbered profiles, use Replace active rotation to pause legacy entries. Keeping the Redis database is intentional so earlier data remains accessible.

## Two independent Netlify websites

You can use this same codebase in both the original and second Netlify projects. **Each site must use its own Upstash database**, otherwise the same key namespace will intentionally cause the two sites to share profiles, daily checkboxes, points, and stats. Each site should also have its own `ADMIN_KEY`.

## Security/ops notes

Keep your Netlify project and admin key private. Do not commit the Redis URL token, credentials or `ADMIN_KEY` to GitHub. Rotate the `ADMIN_KEY` if compromised. The code validates destinations to `https://pro.tiktok.com/t/...` and sanitizes user-facing text, but the manager is a lightweight password-protected tool, not a full identity platform. Use the JSON/CSV exports as periodic backups. Your account's actual TikTok points and payouts should be reconciled separately.

## Troubleshooting

- `404` on `/admin`: verify Base/Publish settings and that `public/admin.html` exists in the deployed artifacts.
- `503` when redirecting or authenticating: check the deployed Functions log for Redis errors, and verify all 3 env vars.
- Redirect service says no destinations: turn on at least one profile.
- Dashboard counts do not match TikTok analytics: they only count attempted server-side redirects, not completed third-party visits.
- Midnight checkbox appears unchanged in an idle tab: refresh the page. The server calculates the New York day independently of the browser time zone.

## Architecture

- `netlify.toml` routes `/` and `/go` to the rotation function and `/api/admin` to the private admin function.
- `netlify/functions/_core.mjs` contains validation, parser, timezone utilities and Upstash REST integration.
- `netlify/functions/admin.mjs` implements the dashboard API (including `?days=30&end=YYYY-MM-DD` daily reporting) and Redis-atomic mutations.
- `netlify/functions/rotate.mjs` handles GET redirects, per-profile counters, per-day profile counters and per-day **exact URL** counters.
- `public/admin.html`, `public/assets/app.css` and `public/assets/app.js` implement the responsive operator dashboard.
