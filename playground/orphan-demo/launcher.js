// Starts server.js as a detached process and exits immediately, so the server's
// parent is gone -> it should appear under "Orphaned".
const { spawn } = require('child_process');
const path = require('path');
const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { detached: true, stdio: 'ignore', windowsHide: true });
child.unref();
console.log(`orphan-demo: started detached server (PID ${child.pid}) on port 4500, launcher exiting now.`);
