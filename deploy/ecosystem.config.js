// Configuration PM2 (modèle). Ne mets pas tes vraies valeurs dans ce fichier versionné :
//   cp deploy/ecosystem.config.js deploy/ecosystem.local.config.js   (ignoré par git)
//   puis adapte PORT / PUBLIC_URL / ALLOWED_ORIGIN et lance : pm2 start deploy/ecosystem.local.config.js
module.exports = {
  apps: [
    {
      name: 'action-ou-verite',
      script: 'server/index.js',
      cwd: __dirname + '/..',
      // Une seule instance : l'état des parties est en mémoire (pas de cluster).
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3004,
        PUBLIC_URL: 'https://jeu.example.com',
        ALLOWED_ORIGIN: 'https://jeu.example.com',
        TRUST_PROXY: '1',
      },
      time: true,
    },
  ],
};
