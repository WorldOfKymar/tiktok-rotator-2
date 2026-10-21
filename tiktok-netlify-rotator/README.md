# Netlify TikTok Pro Link Rotator — Admin Upgrade

This is an upgrade to the existing deployment. It uses your EXISTING Netlify Upstash Redis environment variables. It adds `/admin` for pasting link replacements and keeps `/dashboard.html` for per-URL statistics.

## Updating your existing GitHub repo (do NOT create a second Netlify site)

Your repository currently has all project files under `tiktok-netlify-rotator/`.

1. Download this ZIP, unzip it on your Mac.
2. Open your GitHub repository and navigate into `tiktok-netlify-rotator`.
3. Replace the existing `netlify.toml`, `README.md`, `links.json`, `public` folder and `netlify` folder with the files from this ZIP. Preserve the folder structure. GitHub's browser uploader may not conveniently overwrite nested files: use GitHub Desktop to copy all files over the checked-out local repo, then commit and push; or use GitHub's edit/upload interface for each modified and new file.
4. Keep your existing Netlify Base directory `tiktok-netlify-rotator`, Publish directory `public`, and Functions directory `netlify/functions`.
5. Confirm these existing Netlify environment variables are present: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `ADMIN_KEY`. Never put these values in GitHub or share them in chat.
6. Netlify will redeploy after a GitHub push. Open `https://YOUR-SITE.netlify.app/admin` and enter your `ADMIN_KEY`.
7. Click **Load current links**, paste one TikTok Pro URL per line, then **Save and activate links**. Changes take effect immediately without another deploy.

## Behavior

- Netlify Functions use Upstash Redis REST EVAL Lua scripts. Atomic Redis operations choose a round-robin destination and increase the permanent per-URL redirect count.
- On the first visit after upgrading, the link list is automatically initialized from `links.json` if no editable list exists in Redis.
- Link edits persist in Upstash Redis. The repo's `links.json` remains an initial fallback for new databases only, not the live list after editing.
- Link saves reset the rotation position, but historical counts remain associated with URL strings. The dashboard reports total lifetime redirects and counts for current links. This means totals can be larger than the sum for current links if old URLs were removed.
- This tracks assigned HTTP redirects, not actual TikTok participation, views, or reward eligibility.
- The admin password is never stored by the UI. HTTPS and a strong unique `ADMIN_KEY` are required. Consider rate limiting/admin identity integration for public production use.
- Link changes and rotation share an atomic Redis operation to avoid concurrent edit/redirect inconsistencies.

## Troubleshooting

A 404 usually means Netlify base/publish settings do not match repo layout; a 503 typically means missing Redis configuration or Redis execution failure. Check Netlify Functions logs. Admin page is `/admin` or `/admin.html`; analytics is `/dashboard.html`.
