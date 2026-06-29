const express = require('express');         // Framework web para Node.js
const multer  = require('multer');          // Librería para recibir archivos subidos
const { exec } = require('child_process'); // Para ejecutar comandos del sistema (lp, lpr)
const path    = require('path');            // Para manejar rutas de archivos
const fs      = require('fs');              // Para leer y escribir archivos
const { PDFDocument } = require('pdf-lib'); // Para contar páginas de PDFs

const app  = express(); 
const PORT = 3000;      

const HISTORIAL_FILE = 'historial.json';
const USUARIOS_FILE = 'usuarios.json';

// Cargar historial
let colaImpresion = fs.existsSync(HISTORIAL_FILE)
    ? JSON.parse(fs.readFileSync(HISTORIAL_FILE, 'utf8'))
    : [];

// Cargar usuarios
let usuarios = fs.existsSync(USUARIOS_FILE)
    ? JSON.parse(fs.readFileSync(USUARIOS_FILE, 'utf8'))
    : [
        {
            id: 1,
            nombre: 'Administrador',
            usuario: 'admin',
            password: 'admin123',
            rol: 'admin',
            activo: true
        }
    ];

if (!fs.existsSync(USUARIOS_FILE)) {
    fs.writeFileSync(USUARIOS_FILE, JSON.stringify(usuarios, null, 2));
}

let contadorId = colaImpresion.length + 1;

// Impresoras disponibles
let impresoras = [
    { nombre: 'PDF', activa: true },
    { nombre: 'HP-LaserJet', activa: true },
    { nombre: 'Canon-Oficina', activa: true },
    { nombre: 'Epson-Administracion', activa: true }
];

// Configuración de subida de archivos
const storage = multer.diskStorage({
    destination: 'uploads/',

    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

// Validación de extensiones
const upload = multer({
    storage: storage,

    fileFilter: (req, file, cb) => {
        const extensionesPermitidas = ['.pdf', '.txt', '.png', '.jpg', '.jpeg', '.docx'];
        const ext = path.extname(file.originalname).toLowerCase();

        if (extensionesPermitidas.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Formato de archivo no soportado por PrintSolutions.'));
        }
    }
});

app.use(express.static('public'));
app.use(express.json());

// Enviar archivo a CUPS
function enviarACUPS(filepath, impresora, copias, callback) {
    const comando = `lp -d ${impresora} -n ${copias} "${filepath}"`;

    console.log(`[CUPS] Ejecutando: ${comando}`);

    exec(comando, (error, stdout, stderr) => {
        if (error) {
            console.error(`[CUPS] Error al enviar a impresión: ${stderr}`);
            callback(error, null);
        } else {
            console.log(`[CUPS] Enviado correctamente: ${stdout}`);
            callback(null, stdout);
        }
    });
}

// Solicitar impresión
app.post('/api/solicitar', upload.single('archivo'), async (req, res) => {
    const usuarioFormulario = req.body.usuario || 'No informado';
    const impresora = req.body.impresora || 'PDF';
    const copias = parseInt(req.body.copias) || 1;

    const loginUsuario = req.body.loginUsuario;
    const loginClave = req.body.loginClave;

    // Validar usuario antes de permitir imprimir
    const usuarioAutorizado = usuarios.find(u =>
        u.usuario === loginUsuario &&
        u.password === loginClave &&
        u.activo === true
    );

    if (!usuarioAutorizado) {
        if (req.file) {
            fs.unlink(req.file.path, () => {});
        }

        return res.status(401).json({
            error: 'Usuario o contraseña incorrectos, o usuario inactivo.'
        });
    }

    if (!req.file) {
        return res.status(400).json({
            error: 'No se subió ningún archivo válido.'
        });
    }

    const filepath = req.file.path;
    const nombreArchivo = req.file.originalname;

    let paginas = 1;

    // Contar páginas si el archivo es PDF
    if (path.extname(nombreArchivo).toLowerCase() === '.pdf') {
        try {
            const pdfBytes = fs.readFileSync(filepath);
            const pdfDoc = await PDFDocument.load(pdfBytes);
            paginas = pdfDoc.getPageCount();
        } catch (error) {
            paginas = 'No detectado';
        }
    }

    const trabajo = {
        id: contadorId++,
        usuario: usuarioAutorizado.nombre,
        usuarioFormulario: usuarioFormulario,
        archivo: nombreArchivo,
        impresora: impresora,
        paginas: paginas,
        copias: copias,
        estado: 'Enviando a CUPS...',
        filepath: filepath,
        fecha: new Date().toISOString()
    };

    colaImpresion.push(trabajo);

    console.log('================================');
    console.log('NUEVA SOLICITUD DE IMPRESIÓN');
    console.log(`Usuario   : ${usuarioAutorizado.nombre}`);
    console.log(`Archivo   : ${nombreArchivo}`);
    console.log(`Impresora : ${impresora}`);
    console.log(`Páginas   : ${paginas}`);
    console.log(`Copias    : ${copias}`);
    console.log('================================');

    enviarACUPS(filepath, impresora, copias, (error, resultado) => {
        if (error) {
            trabajo.estado = 'Enviado al servidor';
            trabajo.errorCUPS = error.message;
        } else {
            trabajo.estado = 'Enviado a impresión';

            const matchId = resultado.match(/(?:request id is|id solicitada es)\s+(\S+)/i);
            trabajo.jobIdCUPS = matchId ? matchId[1] : 'desconocido';
        }

        fs.writeFileSync(HISTORIAL_FILE, JSON.stringify(colaImpresion, null, 2));

        res.json({
            message: error
                ? 'El archivo fue recibido por el servidor.'
                : 'Documento enviado correctamente a impresión.',
            trabajo: trabajo
        });
    });
});

// Historial / cola
app.get('/api/cola', (req, res) => {
    res.json(colaImpresion);
});

// Cancelar trabajo
app.post('/api/cancelar/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const trabajo = colaImpresion.find(t => t.id === id);

    if (!trabajo) {
        return res.status(404).json({ error: 'Trabajo no encontrado.' });
    }

    if (trabajo.jobIdCUPS && trabajo.jobIdCUPS !== 'desconocido') {
        const comandoCancelar = `cancel ${trabajo.jobIdCUPS}`;

        exec(comandoCancelar, (error) => {
            if (error) {
                console.error(`[CUPS] No se pudo cancelar el job ${trabajo.jobIdCUPS}`);
            } else {
                console.log(`[CUPS] Job ${trabajo.jobIdCUPS} cancelado`);
            }
        });
    }

    trabajo.estado = 'Cancelado';

    fs.writeFileSync(HISTORIAL_FILE, JSON.stringify(colaImpresion, null, 2));

    res.json({
        message: 'Trabajo cancelado correctamente.',
        trabajo: trabajo
    });
});

// Estado del servidor
app.get('/api/estado', (req, res) => {
    res.json({
        status: 'online',
        servidor: 'Debian 13',
        servicio: 'CUPS'
    });
});

// Impresoras
app.get('/api/impresoras', (req, res) => {
    res.json(impresoras);
});

app.post('/api/impresoras/:nombre/toggle', (req, res) => {
    const nombre = req.params.nombre;
    const impresora = impresoras.find(i => i.nombre === nombre);

    if (!impresora) {
        return res.status(404).json({ error: 'Impresora no encontrada.' });
    }

    impresora.activa = !impresora.activa;

    res.json({
        message: 'Estado de impresora actualizado.',
        impresora: impresora
    });
});

// Usuarios
app.get('/api/usuarios', (req, res) => {
    const usuariosSeguros = usuarios.map(u => ({
        id: u.id,
        nombre: u.nombre,
        usuario: u.usuario,
        rol: u.rol,
        activo: u.activo
    }));

    res.json(usuariosSeguros);
});

app.post('/api/usuarios', (req, res) => {
    const { nombre, usuario, password, rol } = req.body;

    if (!nombre || !usuario || !password) {
        return res.status(400).json({
            error: 'Faltan campos obligatorios.'
        });
    }

    const existe = usuarios.find(u => u.usuario === usuario);

    if (existe) {
        return res.status(400).json({
            error: 'El nombre de usuario ya existe.'
        });
    }

    const nuevoUsuario = {
        id: usuarios.length + 1,
        nombre: nombre,
        usuario: usuario,
        password: password,
        rol: rol || 'usuario',
        activo: true
    };

    usuarios.push(nuevoUsuario);

    fs.writeFileSync(USUARIOS_FILE, JSON.stringify(usuarios, null, 2));

    res.json({
        message: 'Usuario creado correctamente.',
        usuario: {
            id: nuevoUsuario.id,
            nombre: nuevoUsuario.nombre,
            usuario: nuevoUsuario.usuario,
            rol: nuevoUsuario.rol
        }
    });
});

app.post('/api/usuarios/:id/toggle', (req, res) => {
    const id = parseInt(req.params.id);
    const usuario = usuarios.find(u => u.id === id);

    if (!usuario) {
        return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    if (usuario.id === 1) {
        return res.status(400).json({
            error: 'No se puede desactivar al administrador principal.'
        });
    }

    usuario.activo = !usuario.activo;

    fs.writeFileSync(USUARIOS_FILE, JSON.stringify(usuarios, null, 2));

    res.json({
        message: 'Estado del usuario actualizado.',
        usuario: {
            id: usuario.id,
            usuario: usuario.usuario,
            activo: usuario.activo
        }
    });
});

app.delete('/api/usuarios/:id', (req, res) => {
    const id = parseInt(req.params.id);

    if (id === 1) {
        return res.status(400).json({
            error: 'No se puede eliminar al administrador principal.'
        });
    }

    const index = usuarios.findIndex(u => u.id === id);

    if (index === -1) {
        return res.status(404).json({
            error: 'Usuario no encontrado.'
        });
    }

    usuarios.splice(index, 1);

    fs.writeFileSync(USUARIOS_FILE, JSON.stringify(usuarios, null, 2));

    res.json({
        message: 'Usuario eliminado correctamente.'
    });
});

app.listen(PORT, () => {
    console.log(`Servidor PrintSolutions en ejecución en puerto ${PORT}`);
});
