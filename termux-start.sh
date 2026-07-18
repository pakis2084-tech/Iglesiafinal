#!/data/data/com.termux/files/usr/bin/bash
# Arranque recomendado en Termux: evita que Android mate el proceso en segundo
# plano y reinicia el servidor automaticamente si se cae (crash del bot, etc).
set -e

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock

if command -v pm2 >/dev/null 2>&1; then
    pm2 start ecosystem.config.js
    pm2 save
else
    echo "PM2 no esta instalado. Instalalo con: npm install -g pm2"
    echo "Arrancando sin PM2 (sin reinicio automatico si el proceso se cae)."
    node server.js
fi
