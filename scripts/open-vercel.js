const { execFile } = require('child_process');

const url = 'https://jueguito-8bits.vercel.app/';
const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];

execFile(command, args, error => {
  if (error) {
    console.error(`No se pudo abrir el navegador. Abre manualmente: ${url}`);
    process.exitCode = 1;
  }
});

console.log(`Abriendo el juego: ${url}`);
