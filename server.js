const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');


const app = express();
const PORT = 3000;

// Archivo donde se guarda el historial de impresiones
const HISTORIAL_FILE = 'historial.json';

// Arreglo donde se almacenan los trabajos enviados
let colaImpresion = [];

// Lista de impresoras disponibles en el sistema
let impresoras = [
    { nombre: 'PDF', activa: true },
    { nombre: 'HP-LaserJet', activa: true },
    { nombre: 'Canon-Oficina', activa: true },
    { nombre: 'Epson-Administracion', activa: true }
];


if (fs.existsSync(HISTORIAL_FILE)) {
    colaImpresion = JSON.parse(fs.readFileSync(HISTORIAL_FILE, 'utf8'));
}


let contadorId = colaImpresion.length + 1;


const storage = multer.diskStorage({

    // Carpeta donde se guardan temporalmente los archivos subidos
    destination: 'uploads/',

    // Nombre interno del archivo para evitar duplicados
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});


const upload = multer({
    storage: storage,

    fileFilter: (req, file, cb) => {

        // RF06: Filtro estricto de extensiones permitidas
        const extensionesPermitidas = [
            '.pdf',
            '.txt',
            '.png',
            '.jpg',
            '.jpeg',
            '.docx'
        ];

        const ext = path.extname(file.originalname).toLowerCase();

        if (extensionesPermitidas.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Formato de archivo no soportado por PrintSolutions.'));
        }
    }
});


// MIDDLEWARES

app.use(express.static('public'));

// Permite recibir datos en formato JSON
app.use(express.json());

// RUTA PRINCIPAL: Procesa el archivo y lo manda a CUPS
app.post('/api/solicitar', upload.single('archivo'), async (req, res) => {

    const usuario = req.body.usuario || 'No informado';
    const impresora = req.body.impresora || 'PDF';
    const copias = req.body.copias || 1;

    // Si no se subió archivo, se responde con error
    if (!req.file) {
        return res.status(400).json({
            error: 'No se subió ningún archivo válido.'
        });
    }

    const filepath = req.file.path;
    const nombreArchivo = req.file.originalname;

    
    let paginas = 1;


    // CONTADOR DE PÁGINAS PARA PDF
    if (path.extname(nombreArchivo).toLowerCase() === '.pdf') {
        try {
            const pdfBytes = fs.readFileSync(filepath);
            const pdfDoc = await PDFDocument.load(pdfBytes);
            paginas = pdfDoc.getPageCount();
        } catch (error) {
            paginas = 'No detectado';
        }
    }

    // Trabajo de impresión registrado en el sistema
    const trabajo = {
        id: contadorId++,
        usuario: usuario,
        archivo: nombreArchivo,
        impresora: impresora,
        paginas: paginas,
        copias: copias,
        estado: 'Enviado a impresión',
        filepath: filepath
    };

    
    colaImpresion.push(trabajo);

    
    fs.writeFileSync(
        HISTORIAL_FILE,
        JSON.stringify(colaImpresion, null, 2)
    );

   
    console.log('================================');
    console.log('NUEVA SOLICITUD DE IMPRESIÓN');
    console.log(`Usuario   : ${usuario}`);
    console.log(`Archivo   : ${nombreArchivo}`);
    console.log(`Impresora : ${impresora}`);
    console.log(`Páginas   : ${paginas}`);
    console.log(`Copias    : ${copias}`);
    console.log('================================');

    res.json({
        message: 'Documento enviado correctamente a impresión.',
        trabajo: trabajo
    });
});


app.get('/api/cola', (req, res) => {
    res.json(colaImpresion);
});


app.post('/api/cancelar/:id', (req, res) => {

    const id = parseInt(req.params.id);
    const trabajo = colaImpresion.find(t => t.id === id);

    if (!trabajo) {
        return res.status(404).json({
            error: 'Trabajo no encontrado.'
        });
    }

    trabajo.estado = 'Cancelado';

    
    fs.unlink(trabajo.filepath, (err) => {
        if (err) console.error(err);
    });

    // Actualiza el historial después de cancelar
    fs.writeFileSync(
        HISTORIAL_FILE,
        JSON.stringify(colaImpresion, null, 2)
    );

    console.log('TRABAJO CANCELADO');
    console.log(trabajo);

    res.json({
        message: 'Trabajo cancelado correctamente.',
        trabajo: trabajo
    });
});


//  verifica si la API está funcionando.

app.get('/api/estado', (req, res) => {
    res.json({
        status: 'online',
        servidor: 'Debian 13',
        servicio: 'CUPS'
    });
});


// Devuelve la lista de impresoras y su estado.
app.get('/api/impresoras', (req, res) => {
    res.json(impresoras);
});


// Permite administrar las impresoras disponibles.
// Si una impresora está inactiva no aparece al usuario.
app.post('/api/impresoras/:nombre/toggle', (req, res) => {

    const nombre = req.params.nombre;
    const impresora = impresoras.find(i => i.nombre === nombre);

    if (!impresora) {
        return res.status(404).json({
            error: 'Impresora no encontrada.'
        });
    }

    impresora.activa = !impresora.activa;

    res.json({
        message: 'Estado de impresora actualizado.',
        impresora: impresora
    });
});


app.listen(PORT, () => {
    console.log(`Servidor PrintSolutions en ejecución en puerto ${PORT}`);
});