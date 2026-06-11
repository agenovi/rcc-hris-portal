#!/bin/bash
# RCC HRIS Portal — deploy the app to the live public site (GitHub Pages).
# Rebuilds the single-file app from index.html + config.js + app.js, then pushes.
# Live URL: https://agenovi.github.io/rcc-hris-portal/
set -e
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="/Users/anj/.local/share/rcc-hris/site"
TOKEN_FILE="/Users/anj/.local/share/rcc-hris/gh_token"

# 1. Build combined single-file.
#    IMPORTANT: use a REPLACEMENT FUNCTION (not a string) so JS replace() does
#    NOT interpret $$, $&, $`, $' inside the JS — that previously corrupted $$ -> $.
node -e '
const fs=require("fs");
const appDir=process.argv[1], siteDir=process.argv[2];
let html=fs.readFileSync(appDir+"/index.html","utf8");
const cfg=fs.readFileSync(appDir+"/config.js","utf8");
const app=fs.readFileSync(appDir+"/app.js","utf8");
html=html.replace(`<script src="./config.js"></script>`, () => "<script>\n"+cfg+"\n</script>");
html=html.replace(`<script src="./app.js"></script>`, () => "<script>\n"+app+"\n</script>");
fs.writeFileSync(siteDir+"/index.html",html);
fs.writeFileSync(siteDir+"/404.html",html);
// sanity check: no accidental duplicate "const $ =" (the old corruption signature)
const dupes=(html.match(/const \$ =/g)||[]).length;
if(dupes>1){ console.error("BUILD ERROR: duplicate const $ — inlining corrupted the JS"); process.exit(1); }
console.log("build ok");
' "$APP_DIR" "$SITE_DIR"

# 1a2. Publish anj's preferred Loan Portal as a standalone page (embedded by the Loans tab)
[ -f "$APP_DIR/loans.html" ] && cp "$APP_DIR/loans.html" "$SITE_DIR/loans.html"
[ -f "$APP_DIR/agency.html" ] && cp "$APP_DIR/agency.html" "$SITE_DIR/agency.html"

# 1b. Also refresh the local double-clickable copy in the project folder (for easy viewing)
cp "$SITE_DIR/index.html" "/Users/anj/Library/CloudStorage/Dropbox/CLAUDE/RCC HRIS Portal/RCC HRIS Portal - LIVE APP.html"

# 1c. Back up the editable SOURCE into the repo (/src) so GitHub keeps full version history
mkdir -p "$SITE_DIR/src"
cp "$APP_DIR/index.html" "$APP_DIR/app.js" "$APP_DIR/config.js" "$APP_DIR/deploy.sh" "$APP_DIR/server.js" "$SITE_DIR/src/" 2>/dev/null || true
[ -f "$APP_DIR/README.md" ] && cp "$APP_DIR/README.md" "$SITE_DIR/src/"

# 2. Commit + push
cd "$SITE_DIR"
git remote set-url origin "https://x-access-token:$(cat $TOKEN_FILE)@github.com/agenovi/rcc-hris-portal.git"
git add -A
git -c user.email="anj@hassarams.com" -c user.name="RCC" commit -q -m "Update portal $(date +%Y-%m-%d)" || { echo "no changes"; exit 0; }
git push -q origin main
echo "Deployed → https://agenovi.github.io/rcc-hris-portal/ (live within ~1 min)"
