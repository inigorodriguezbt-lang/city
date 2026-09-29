#!/bin/sh
# usage: shoot.sh <query/page> <out.png> [gpuWaitMs=30000] [WxH]
# waits for the sandbox to finish drawing (window.__done), then for the GPU backlog, then shoots
URL="http://localhost:5209/sandbox/buildings-zoned/$1"
exec timeout 600 node /home/user/city/sandbox/buildings-zoned/shot.cjs "$URL" "$2" 2000 "${4:-1280x800}" --eval "for (let i = 0; i < 600 && !window.__done; i++) await new Promise((r) => setTimeout(r, 500)); await new Promise((r) => setTimeout(r, ${3:-30000})); return document.getElementById('hud')?.textContent" 2>&1 | grep -v "ERR_CERT\|GPU stall"
