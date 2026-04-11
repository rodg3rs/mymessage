require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
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
    // 1. Garante que a tabela tenha a estrutura correta (id e value)
    await db.execute("CREATE TABLE IF NOT EXISTS dwhatsapp (id TEXT PRIMARY KEY, value TEXT)");

    // 2. Tenta carregar sessão do banco
    let res;
    try {
        res = await db.execute("SELECT value FROM dwhatsapp WHERE id = 'session'");
    } catch (e) {
        console.log("Ajustando estrutura da tabela...");
        // Caso a tabela exista mas esteja sem a coluna, este comando resolve:
        await db.execute("DROP TABLE IF EXISTS dwhatsapp");
        await db.execute("CREATE TABLE dwhatsapp (id TEXT PRIMARY KEY, value TEXT)");
        res = { rows: [] };
    }
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_temp');
    
    if (res.rows && res.rows.length > 0) {
        state.creds = JSON.parse(res.rows[0].value);
        console.log("✅ Sessão carregada do Turso.");
    }

    // Localize esta linha no seu server.js e substitua:
    sock = makeWASocket({ 
       auth: state,
       logger: require('pino')({ level: 'silent' }) // Isso silencia o excesso de logs
   });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        await db.execute({
            sql: "INSERT OR REPLACE INTO dwhatsapp (id, value) VALUES ('session', ?)",
            args: [JSON.stringify(state.creds)]
        });
    });

sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
        console.log("\n========================================");
        console.log("LINK PARA ESCANEAR O QR CODE:");
        console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}`);
        console.log("========================================\n");
    }

    if (connection === 'open') console.log("✅ WhatsApp Conectado!");
    
    if (connection === 'close') {
        const deveReconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (deveReconectar) {
            console.log("🔄 Reconectando...");
            conectarWA();
        }
    }
});

}

app.post('/api/enviar-oi', async (req, res) => {
    try {
        await sock.sendMessage("5519981266942@s.whatsapp.net", { text: "Oi" });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

conectarWA();
app.listen(process.env.PORT || 3000, () => console.log("Servidor Online!"));