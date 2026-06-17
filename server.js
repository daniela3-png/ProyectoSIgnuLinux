const express = require('express');         // Framework web para Node.js
const multer  = require('multer');          // Librería para recibir archivos subidos
const { exec } = require('child_process'); // Para ejecutar comandos del sistema (lp, lpr)
const path    = require('path');            // Para manejar rutas de archivos
const fs      = require('fs');              // Para leer y escribir archivos
const { PDFDocument } = require('pdf-lib'); // Para contar páginas de PDFs

const app  = express(); 
const PORT = 3000;      



const HISTORIAL_FILE = 'historial.json'; 
const USUARIOS_FILE  = 'usuarios.json';  

// CARGA INICIAL DE DATOS

// Si ya existe un historial previo, lo cargamos al iniciar el servidor
let colaImpresion = fs.existsSync(HISTORIAL_FILE)
    ? JSON.parse(fs.readFileSync(HISTORIAL_FILE, 'utf8'))
    : [];

// Si ya existen usuarios guardados, los cargamos; si no, creamos el admin por defecto
let usuarios = fs.existsSync(USUARIOS_FILE)
    ? JSON.parse(fs.readFileSync(USUARIOS_FILE, 'utf8'))
    : [
        {
            id: 1,
            nombre: 'Administrador',    
            usuario: 'admin',           // Nombre de usuario para login
            password: 'admin123',       // Contraseña 
            rol: 'admin',               
            activo: true                
        }
    ];


if (!fs.existsSync(USUARIOS_FILE)) {
    fs.writeFileSync(USUARIOS_FILE, JSON.stringify(usuarios, null, 2));
}


let contadorId = colaImpresion.length + 1;

// Lista de impresoras disponibles en el sistema
let impresoras = [
    { nombre: 'PDF',                  activa: true },
    { nombre: 'HP-LaserJet',          activa: true },
    { nombre: 'Canon-Oficina',        activa: true },
    { nombre: 'Epson-Administracion', activa: true }
];


// Configuramos dónde y cómo se guardan los archivos subidos
const storage = multer.diskStorage({
    destination: 'uploads/', 

    
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

// RF06 Filtro de extensiones
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const extensionesPermitidas = ['.pdf', '.txt', '.png', '.jpg', '.jpeg', '.docx'];
        const ext = path.extname(file.originalname).toLowerCase(); 

        if (extensionesPermitidas.includes(ext)) {
            cb(null, true); // Aceptamos el archivo
        } else {
            cb(new Error('Formato de archivo no soportado por PrintSolutions.')); // Rechazamos el archivo
        }
    }
});

//MIDDLEWARES 

app.use(express.static('public')); 
app.use(express.json());           

// FUNCIÓN ENVIAR A CUPS 

/**
 * 
 *
 * @param {string} filepath   - Ruta del archivo a imprimir
 * @param {string} impresora  - Nombre de la impresora en CUPS
 * @param {number} copias     - Cantidad de copias
 * @param {Function} callback - Función que se ejecuta cuando termina (error, resultado)
 */
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

//RUTAS DE LA API 

// POST /api/solicitar Recibe el documento y lo envía a CUPS
app.post('/api/solicitar', upload.single('archivo'), async (req, res) => {

    const usuario  = req.body.usuario  || 'No informado'; 
    const impresora = req.body.impresora || 'PDF';         
    const copias   = parseInt(req.body.copias) || 1;       

    
    if (!req.file) {
        return res.status(400).json({ error: 'No se subió ningún archivo válido.' });
    }

    const filepath      = req.file.path;          
    const nombreArchivo = req.file.originalname;  

    
    let paginas = 1; 

    if (path.extname(nombreArchivo).toLowerCase() === '.pdf') {
        try {
            const pdfBytes = fs.readFileSync(filepath);       
            const pdfDoc   = await PDFDocument.load(pdfBytes); // Lo cargamos con pdf-lib
            paginas        = pdfDoc.getPageCount();            
        } catch (error) {
            paginas = 'No detectado'; 
        }
    }

    const trabajo = {
        id:        contadorId++,             
        usuario:   usuario,                  
        archivo:   nombreArchivo,            
        impresora: impresora,                
        paginas:   paginas,                  
        copias:    copias,                   
        estado:    'Enviando a CUPS...',     
        filepath:  filepath,                 
        fecha:     new Date().toISOString()  
    };

    // Agregamos el trabajo a la cola antes de enviarlo a CUPS
    colaImpresion.push(trabajo);

    // Mostramos en consola el resumen del trabajo
    console.log('================================');
    console.log('NUEVA SOLICITUD DE IMPRESIÓN');
    console.log(`Usuario   : ${usuario}`);
    console.log(`Archivo   : ${nombreArchivo}`);
    console.log(`Impresora : ${impresora}`);
    console.log(`Páginas   : ${paginas}`);
    console.log(`Copias    : ${copias}`);
    console.log('================================');

    
    enviarACUPS(filepath, impresora, copias, (error, resultado) => {

        if (error) {
            
            trabajo.estado = 'Enviado al servidor';
            trabajo.errorCUPS = error.message; 

            console.error(`[CUPS] Falló el envío del trabajo ${trabajo.id}`);
        } else {
            
            trabajo.estado = 'Enviado a impresión';

            
            const matchId = resultado.match(/request id is (\S+)/);
            trabajo.jobIdCUPS = matchId ? matchId[1] : 'desconocido'; 

            console.log(`[CUPS] Job ID asignado: ${trabajo.jobIdCUPS}`);
        }

       
        fs.writeFileSync(HISTORIAL_FILE, JSON.stringify(colaImpresion, null, 2));

        
        res.json({
            message: error
                ? 'Error al comunicarse con CUPS. El archivo fue recibido pero no impreso.'
                : 'Documento enviado correctamente a impresión.',
            trabajo: trabajo
        });
    });
});

// GET /api/cola Devuelve todos los trabajos en el historial
app.get('/api/cola', (req, res) => {
    res.json(colaImpresion); 
});

app.post('/api/cancelar/:id', (req, res) => {

    const id      = parseInt(req.params.id); 
    const trabajo = colaImpresion.find(t => t.id === id); 

    
    if (!trabajo) {
        return res.status(404).json({ error: 'Trabajo no encontrado.' });
    }

    if (trabajo.jobIdCUPS && trabajo.jobIdCUPS !== 'desconocido') {
        const comandoCancelar = `cancel ${trabajo.jobIdCUPS}`; 
        exec(comandoCancelar, (error) => {
            if (error) {
                console.error(`[CUPS] No se pudo cancelar el job ${trabajo.jobIdCUPS} en CUPS`);
            } else {
                console.log(`[CUPS] Job ${trabajo.jobIdCUPS} cancelado en CUPS`);
            }
        });
    }

    trabajo.estado = 'Cancelado'; 

    fs.unlink(trabajo.filepath, (err) => {
        if (err) console.error('Error al eliminar archivo:', err);
    });

    fs.writeFileSync(HISTORIAL_FILE, JSON.stringify(colaImpresion, null, 2));

    console.log('TRABAJO CANCELADO');
    console.log(trabajo);

    res.json({ message: 'Trabajo cancelado correctamente.', trabajo: trabajo });
});

app.get('/api/estado', (req, res) => {
    res.json({
        status:   'online',
        servidor: 'Debian 13',
        servicio: 'CUPS'
    });
});

// GET /api/impresoras Devuelve la lista de impresoras y su estado
app.get('/api/impresoras', (req, res) => {
    res.json(impresoras); 
});

//  Activa o desactiva una impresora
app.post('/api/impresoras/:nombre/toggle', (req, res) => {

    const nombre    = req.params.nombre; 
    const impresora = impresoras.find(i => i.nombre === nombre); 

    
    if (!impresora) {
        return res.status(404).json({ error: 'Impresora no encontrada.' });
    }

    impresora.activa = !impresora.activa; 

    res.json({ message: 'Estado de impresora actualizado.', impresora: impresora });
});

// RUTAS DE USUARIOS (RF08) 


app.get('/api/usuarios', (req, res) => {
    
    const usuariosSeguros = usuarios.map(u => ({
        id:      u.id,
        nombre:  u.nombre,
        usuario: u.usuario,
        rol:     u.rol,
        activo:  u.activo
        
    }));
    res.json(usuariosSeguros); 
});


app.post('/api/usuarios', (req, res) => {

    const { nombre, usuario, password, rol } = req.body; 

    
    if (!nombre || !usuario || !password) {
        return res.status(400).json({ error: 'Faltan campos obligatorios: nombre, usuario, password.' });
    }

    
    const existe = usuarios.find(u => u.usuario === usuario);
    if (existe) {
        return res.status(400).json({ error: 'El nombre de usuario ya existe.' });
    }

    // Creamos el nuevo usuario con un ID autoincremental
    const nuevoUsuario = {
        id:       usuarios.length + 1,  
        nombre:   nombre,               
        usuario:  usuario,             
        password: password,             
        rol:      rol || 'usuario',     
        activo:   true                  
    };

    usuarios.push(nuevoUsuario); 

    
    fs.writeFileSync(USUARIOS_FILE, JSON.stringify(usuarios, null, 2));

    console.log(`[USUARIOS] Nuevo usuario creado: ${usuario}`);

    
    res.json({
        message: 'Usuario creado correctamente.',
        usuario: { id: nuevoUsuario.id, nombre: nuevoUsuario.nombre, usuario: nuevoUsuario.usuario, rol: nuevoUsuario.rol }
    });
});


app.post('/api/usuarios/:id/toggle', (req, res) => {

    const id      = parseInt(req.params.id); 
    const usuario = usuarios.find(u => u.id === id); 

    
    if (!usuario) {
        return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    
    if (usuario.id === 1) {
        return res.status(400).json({ error: 'No se puede desactivar al administrador principal.' });
    }

    usuario.activo = !usuario.activo; 

    
    fs.writeFileSync(USUARIOS_FILE, JSON.stringify(usuarios, null, 2));

    res.json({ message: 'Estado del usuario actualizado.', usuario: { id: usuario.id, usuario: usuario.usuario, activo: usuario.activo } });
});


app.delete('/api/usuarios/:id', (req, res) => {

    const id = parseInt(req.params.id); 

   
    if (id === 1) {
        return res.status(400).json({ error: 'No se puede eliminar al administrador principal.' });
    }

    const index = usuarios.findIndex(u => u.id === id); 
    
    if (index === -1) {
        return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    usuarios.splice(index, 1); 

    
    fs.writeFileSync(USUARIOS_FILE, JSON.stringify(usuarios, null, 2));

    console.log(`[USUARIOS] Usuario ID ${id} eliminado`);

    res.json({ message: 'Usuario eliminado correctamente.' });
});


app.listen(PORT, () => {
    console.log(`Servidor PrintSolutions en ejecución en puerto ${PORT}`);
});
