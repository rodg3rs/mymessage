async function conectarWA() {
    if (estaConectando) return;
    estaConectando = true;

    // Tenta ler a sessão do Turso
    const res = await db.execute("SELECT value FROM dwhatsapp WHERE id = 'session'");
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/baileys_auth_v3'); // Nova pasta para limpar cache local
    
    if (res.rows && res.rows.length > 0) {
        state.creds = JSON.parse(res.rows[0].value);
        console.log("✅ Tentando usar sessão do Turso...");
    }

    sock = makeWASocket({ 
       auth: state,
       printQRInTerminal: false,
       logger: require('pino')({ level: 'silent' }),
       browser: ["Windows", "Edge", "1.0.0"] // Identificação clara para o WhatsApp
   });

    // ... (restante dos eventos creds.update e connection.update)
    
    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) {
            console.log("🔗 NOVO QR CODE: https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
        }
        if (connection === 'open') {
            console.log("✅ CONECTADO! Agora você pode testar o botão.");
            estaConectando = false;
        }
        if (connection === 'close') {
            estaConectando = false;
            console.log("🔄 Conexão falhou. Aguardando 30s para não ser bloqueado...");
            setTimeout(() => conectarWA(), 30000); // Aumentado para segurança
        }
    });
}