require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { createClient } = require('@libsql/client');
const qrcode = require('qrcode-terminal');
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
    // 1. Cria a tabela de sessão (letras minúsculas evitam erros no Turso)
    await db.execute("CREATE TABLE IF NOT EXISTS dwhatsapp (id TEXT PRIMARY KEY, value TEXT)");

    // 2. Tenta carregar sessão do banco
    const res = await db.execute("SELECT value FROM dwhatsapp WHERE id = 'session'");
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_temp');
    
    if (res.rows.length > 0) {
        state.creds = JSON.parse(res.rows[0].value);
    }

    sock = makeWASocket({ 
        auth: state,
        printQRInTerminal: false 
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
            console.log("--- ESCANEIE O QR CODE ---");
            console.log(`Link para o QR: https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}`);
        }
        if (connection === 'open') console.log("✅ WhatsApp Conectado!");
        if (connection === 'close') {
            const deveReconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (deveReconectar) conectarWA();
        }
    });
}

// Rota para enviar a mensagem
app.post('/api/enviar-oi', async (req, res) => {
    try {
        const jid = "5519981266942@s.whatsapp.net";
        await sock.sendMessage(jid, { text: "Oi" });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

conectarWA();
app.listen(process.env.PORT || 3000, () => console.log("Servidor Online na porta 3000"));