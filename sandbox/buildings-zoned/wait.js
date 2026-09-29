// eval-file: wait until the sandbox finished its frames, return the HUD text
for (let i = 0; i < 400 && !window.__done; i++) await new Promise((r) => setTimeout(r, 500));
await new Promise((r) => setTimeout(r, window.__extraWait ?? 15000));
return (window.__done ? 'done ' : 'timeout ') + (document.getElementById('hud')?.textContent ?? '');
