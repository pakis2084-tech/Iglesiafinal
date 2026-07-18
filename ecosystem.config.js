// Configuracion de PM2 para mantener el proceso vivo en Termux/Android.
// Uso: pm2 start ecosystem.config.js
module.exports = {
    apps: [
        {
            name: 'ipub-tupiza',
            script: 'server.js',
            autorestart: true,
            max_restarts: 20,
            restart_delay: 3000,
            exp_backoff_restart_delay: 100,
            env: {
                NODE_ENV: 'production'
            }
        }
    ]
};
