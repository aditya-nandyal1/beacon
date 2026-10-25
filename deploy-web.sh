#!/bin/bash
# Build the PWA and deploy to Vercel from outside the git repo (avoids Hobby-tier author checks).
set -e
cd ~/Downloads/beacon && npm run build -w apps/web
rm -rf /tmp/beacon-deploy && cp -r apps/web/dist /tmp/beacon-deploy && cd /tmp/beacon-deploy
vercel link --yes --project beacon >/dev/null
vercel --prod --yes
