// Configuration PM2. Sur le VPS : pm2 start deploy/ecosystem.config.js && pm2 save
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
        PUBLIC_URL: 'https://av.samuel-josephmyrtil.fr',
        ALLOWED_ORIGIN: 'https://av.samuel-josephmyrtil.fr',
        TRUST_PROXY: '1',
      },
      out_file: '/var/log/action-ou-verite/out.log',
      error_file: '/var/log/action-ou-verite/error.log',
      time: true,
    },
  ],
};
