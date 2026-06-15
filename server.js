const express = require('express');
const multer  = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Configuración para guardar archivos subidos
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        // RF06: Filtro estricto de extensiones permitidas
        const extensionesPermitidas = ['.pdf', '.txt', '.png', '.jpg', '.jpeg'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (extensionesPermitidas.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Formato de archivo no soportado por PrintSolutions.'));
        }
    }
});

app.use(express.static('public'));

// RUTA PRINCIPAL: Procesa el archivo y lo manda a CUPS
app.post('/api/imprimir', upload.single('archivo'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No se subió ningún archivo válido.' });
    }

    const filepath = req.file.path;

    // Comando nativo de Linux para imprimir en la cola por defecto (PDF virtual)
    exec(`lp ${filepath}`, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error de CUPS: ${error.message}`);
            return res.status(500).json({ error: 'CUPS no pudo procesar la impresión interna.' });
        }
        
        console.log(`Documento enviado a la cola. Código: ${stdout.trim()}`);
        fs.unlink(filepath, (err) => { if (err) console.error(err); });

        res.json({ 
            message: 'Archivo recibido correctamente.', 
            detalle: 'El documento ha sido enviado exitosamente a la cola de impresión de CUPS.' 
        });
    });
});

// Estado de la API
app.get('/api/estado', (req, res) => {
    res.json({ status: "online", servidor: "Debian 13", servicio: "CUPS" });
});

app.listen(PORT, () => {
    console.log(`Servidor de producción PrintSolutions en ejecución en puerto ${PORT}`);
});