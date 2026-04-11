const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const app = express();

app.use(express.json());
app.use(express.static('public'));

let sock;

async function startWA() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    sock = makeWASocket({ auth: state });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => {
        if (u.qr) {
            console.log("ESCANEIE AQUI:");
            qrcode.generate(u.qr, { small: true });
            // Link de emergência caso o desenho quebre no log do Render
            console.log(`Link do QR: https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(u.qr)}`);
        }
        if (u.connection === 'open') console.log("Conectado!");
    });
}

app.post('/enviar-oi', async (req, res) => {
    try {
        const jid = req.body.numero + "@s.whatsapp.net";
        await sock.sendMessage(jid, { text: req.body.texto });
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

startWA();
app.listen(process.env.PORT || 3000);