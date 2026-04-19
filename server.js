require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { createClient } = require('@libsql/client');
const express = require('express');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let sock;

async function conectarWA() {
    // Garante a tabela no Turso
    await db.execute("CREATE TABLE IF NOT EXISTS dwhatsapp (id TEXT PRIMARY KEY, value TEXT)");

    // Tenta recuperar a sessão salva
    const res = await db.execute("SELECT value FROM dwhatsapp WHERE id = 'session'");
    
    // IMPORTANTE: Usamos um diretório temporário que o Render permite escrever
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/baileys_auth');
    
    if (res.rows.length > 0) {
        state.creds = JSON.parse(res.rows[0].value);
        console.log("✅ Sessão recuperada do Turso.");
    }

    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({ 
       version,
       auth: state,
       printQRInTerminal: false, // Desativado para não poluir o log do Render
       logger: require('pino')({ level: 'silent' }),
       browser: ["Ubuntu", "Chrome", "20.0.04"]
   });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        // Salva sempre no Turso para persistência real
        await db.execute({
            sql: "INSERT OR REPLACE INTO dwhatsapp (id, value) VALUES ('session', ?)",
            args: [JSON.stringify(state.creds)]
        });
    });

    sock.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;

        if (qr) {
            console.log("\n--- ESCANEIE O QR CODE NO LINK ABAIXO ---");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}`);
            console.log("------------------------------------------\n");
        }

        if (connection === 'open') {
            console.log("✅ WhatsApp Conectado!");
        }
        
        if (connection === 'close') {
            const deveReconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (deveReconectar) {
                console.log("🔄 Reconectando em 15 segundos...");
                setTimeout(() => conectarWA(), 15000);
            }
        }
    });
}

// ROTA PARA O BOTÃO DO HTML (index.html)
app.post('/enviar-notificacao', async (req, res) => {
    const { mensagem } = req.body;
    
    if (!sock || !sock.user) {
        return res.status(500).json({ success: false, error: "WhatsApp não está conectado." });
    }

    try {
        // Exemplo: Enviar para um grupo ou lista de utilizadores da BD
        // Aqui você faria um loop nos seus usuários do Turso
        const numeroTeste = "5519981266942@s.whatsapp.net"; 
        await sock.sendMessage(numeroTeste, { text: mensagem });
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

conectarWA();
app.listen(process.env.PORT || 3000, () => console.log("Servidor Online!"));