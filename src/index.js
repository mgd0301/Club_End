const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const sequelize = require('./config/database');
const jwt = require('jsonwebtoken');

dotenv.config();

const app = express();

// ====== MIDDLEWARE ======
app.use(cors());
app.use(express.json());

// ====== PROBAR CONEXIÓN DB ======
sequelize.authenticate()
  .then(() => console.log('Conexión a la base de datos OK'))
  .catch(err => console.error('Error al conectar:', err));

console.log('Servidor arrancado, antes de endpoints');


// ===================================================
// ===============  LOGIN UNIFICADO ==================
// ===================================================
app.post('/login', async (req, res) => {
  const { tipo, identificador, password, email } = req.body;

  try {
    // ---------- LOGIN NORMAL ----------
    if (tipo === 'N') {
      if (!identificador || !password) {
        return res.status(400).json({ mensaje: 'Faltan credenciales' });
      }

      const [rows] = await sequelize.query(
        `SELECT codpersona, nombre, clave, email, telefono, usuario, apodo, color, fotoperfil, tipo_usuario 
         FROM personas 
         WHERE (usuario = :identificador OR email = :identificador OR telefono = :identificador)
         LIMIT 1`,
        {
          replacements: { identificador },
          type: sequelize.QueryTypes.SELECT
        }
      );

      if (!rows) {
        return res.status(404).json({ mensaje: 'Usuario no encontrado' });
      }

      const usuario = rows;

      if (usuario.clave !== password) {
        return res.status(401).json({ mensaje: 'Contraseña incorrecta' });
      }

      const token = jwt.sign(
        { id: usuario.codpersona, email: usuario.email, usuario: usuario.usuario },
        process.env.JWT_SECRET || 'secreto123',
        { expiresIn: '18h' }
      );


      await sequelize.query(
        `INSERT INTO user_sessions (codpersona, ip, user_agent)
        VALUES (:codpersona, :ip, :user_agent)`,
        {
          replacements: {
            codpersona: usuario.codpersona,
            ip: req.ip,
            user_agent: req.headers["user-agent"]
          }
        }
      );
      return res.json({ mensaje: 'Login normal OK', token, usuario });
    }

    // ---------- LOGIN GOOGLE ----------
    if (tipo === 'G') {
      if (!email) return res.status(400).json({ mensaje: 'Falta email de Google' });

      const [rows] = await sequelize.query(
        "SELECT * FROM personas WHERE email = :email LIMIT 1",
        {
          replacements: { email },
          type: sequelize.QueryTypes.SELECT
        }
      );

      if (!rows) {
        return res.status(404).json({ mensaje: 'Usuario Google no registrado' });
      }

      const usuario = rows;

      const token = jwt.sign(
        { id: usuario.codpersona, email: usuario.email, usuario: usuario.usuario },
        process.env.JWT_SECRET || 'secreto123',
        { expiresIn: '1h' }
      );

      await sequelize.query(
        `INSERT INTO user_sessions (codpersona, ip, user_agent)
        VALUES (:codpersona, :ip, :user_agent)`,
        {
          replacements: {
            codpersona: usuario.codpersona,
            ip: req.ip,
            user_agent: req.headers["user-agent"]
          }
        }
      );

      return res.json({ mensaje: 'Login Google OK', token, usuario });
    }

    res.status(400).json({ mensaje: 'Tipo de login inválido' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error interno' });
  }
});
app.post('/logout', async (req, res) => {
  try {

    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(400).json({ mensaje: "Token faltante" });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'secreto123'
    );

    const codpersona = decoded.id;

    await sequelize.query(
      `UPDATE user_sessions
       SET logout_at = NOW(), is_active = 0
       WHERE codpersona = :codpersona
       AND is_active = 1`,
      {
        replacements: { codpersona }
      }
    );

    res.json({ mensaje: "Logout OK" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: "Error en logout" });
  }
});

// ===================================================
// ========== ENDPOINTS PRINCIPALES (POST) ============
// ===================================================


// ===================================================
// 1) CLUBES POR PERSONA
// ===================================================
app.post('/clubes_persona', verificarToken, async (req, res) => {
  const { codpersona } = req.body;

  if (!codpersona)
    return res.status(400).json({ mensaje: 'Falta codpersona' });

  try {
    const rows = await sequelize.query(
      `
      SELECT 
        c.codclub,
        c.descripcion,
        cp.tipo_usuario
      FROM clubes c
      INNER JOIN clubes_personas cp 
        ON c.codclub = cp.codclub
      WHERE c.estado = 'A'
        AND cp.codpersona = :codpersona
      ORDER BY c.descripcion;
      `,
      {
        replacements: { codpersona },
        type: sequelize.QueryTypes.SELECT
      }
    );

    return res.json(rows); // SIEMPRE ARRAY
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error interno' });
  }
});


// ===================================================
// 2) DISCIPLINAS POR CLUB
// ===================================================
app.post('/disciplinas_club', verificarToken, async (req, res) => {
  const { codclub } = req.body;

  if (!codclub)
    return res.status(400).json({ mensaje: 'Falta codclub' });

  try {
    const rows = await sequelize.query(
      `
      SELECT d.coddisciplina, d.descripcion
      FROM disciplinas d
      INNER JOIN clubes_disciplinas cd ON d.coddisciplina = cd.coddisciplina
      WHERE cd.codclub = :codclub
      `,
      {
        replacements: { codclub },
        type: sequelize.QueryTypes.SELECT
      }
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error interno' });
  }
});


// ===================================================
// 3) DIVISIONES POR DISCIPLINA
// ===================================================
app.post('/divisiones_disciplina_old', verificarToken, async (req, res) => {
  const { coddisciplina } = req.body;

  if (!coddisciplina)
    return res.status(400).json({ mensaje: 'Falta coddisciplina' });

  try {
    const rows = await sequelize.query(
      `
      SELECT div.coddivision, div.descripcion
      FROM divisiones div
      INNER JOIN disciplinas_divisiones dd ON div.coddivision = dd.coddivision
      WHERE dd.coddisciplina = :coddisciplina
      `,
      {
        replacements: { coddisciplina },
        type: sequelize.QueryTypes.SELECT
      }
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error interno' });
  }
});

// En tu backend index.js
// ============================================
// ENDPOINT: Obtener divisiones por disciplina y club
// ============================================
app.post('/divisiones_disciplina', verificarToken, async (req, res) => {
  const { coddisciplina, codclub } = req.body;
  
  console.log("Buscando divisiones para disciplina:", coddisciplina, "y club:", codclub);
  
  try {
    const divisiones = await sequelize.query(
      `SELECT coddivision, descripcion 
       FROM divisiones 
       WHERE coddisciplina = :coddisciplina 
         AND codclub = :codclub 
         AND estado = 'A'`,
      {
        replacements: { 
          coddisciplina, 
          codclub 
        },
        type: sequelize.QueryTypes.SELECT
      }
    );
    
    console.log("Divisiones encontradas:", divisiones.length);
    res.json(divisiones);
  } catch (error) {
    console.error("Error en /divisiones_disciplina:", error);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
});

// ============================================
// ENDPOINT: Obtener roles por club
// ============================================
app.post('/roles_por_club', verificarToken, async (req, res) => {
  const { codclub } = req.body;
  
  console.log("Buscando roles para club:", codclub);
  
  try {
    const roles = await sequelize.query(
      `SELECT codrol, descripcion 
       FROM roles 
       order by descripcion`,
      {
        replacements: { codclub },
        type: sequelize.QueryTypes.SELECT
      }
    );
    
    console.log("Roles encontrados:", roles.length);
    res.json(roles);
  } catch (error) {
    console.error("Error en /roles_por_club:", error);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
});

// ============================================
// ENDPOINT: Buscar personas del club y disciplina
// ============================================


// ============================================
// ENDPOINT: Validar personas para importación
// ============================================
app.post('/validar_personas_importacion', verificarToken, async (req, res) => {
  const { codclub, personas } = req.body;
  
  console.log("Validando personas para importación, cantidad:", personas?.length);
  
  try {
    const duplicados = [];
    
    for (const persona of personas) {
      // Buscar en la tabla global de personas por nombre o DNI
      let query = `
        SELECT codpersona, nombre, dni 
        FROM personas 
        WHERE LOWER(nombre) = LOWER(?)
      `;
      let params = [persona.nombre];
      
      // Si tiene DNI, también buscar por DNI exacto
      if (persona.dni && persona.dni.trim() !== '') {
        query = `
          SELECT codpersona, nombre, dni 
          FROM personas 
          WHERE LOWER(nombre) = LOWER(?) OR dni = ?
        `;
        params = [persona.nombre, persona.dni];
      }
      
      const [existing] = await sequelize.query(query, {
        replacements: params,
        type: sequelize.QueryTypes.SELECT
      });
      
      if (existing) {
        // Verificar si ya está asociada a este club
        const [asociacion] = await sequelize.query(
          `SELECT cp.codclub 
           FROM clubes_personas cp 
           WHERE cp.codpersona = ? AND cp.codclub = ?`,
          {
            replacements: [existing.codpersona, codclub],
            type: sequelize.QueryTypes.SELECT
          }
        );
        
        duplicados.push({
          id: existing.codpersona,
          nombre: existing.nombre,
          dni: existing.dni,
          yaEnClub: !!asociacion, // true si ya está en este club
          codpersona: existing.codpersona
        });
      }
    }
    
    console.log("Duplicados encontrados:", duplicados.length);
    res.json({ duplicados });
    
  } catch (error) {
    console.error("Error en /validar_personas_importacion:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ENDPOINT: Importación masiva de personas
// ============================================
// ============================================
// ENDPOINT: Importación masiva de personas
// ============================================
app.post('/importar_personas_masivo', verificarToken, async (req, res) => {
  const { codclub, personas } = req.body;
  
  console.log("Importando personas masivamente, cantidad:", personas?.length);
  
  // Usar transacción
  const t = await sequelize.transaction();
  
  try {
    let creadas = 0; // Personas nuevas en la tabla personas
    let ya_existian = 0; // Personas que ya estaban en la tabla personas
    let asociaciones_club_nuevas = 0; // Nuevas asociaciones club-persona
    let asociaciones_club_existentes = 0; // Asociaciones club que ya existían
    let asociaciones_division_nuevas = 0; // Nuevas asociaciones persona-división
    let asociaciones_division_existentes = 0; // Asociaciones división que ya existían
    let errores = [];
    
    for (const persona of personas) {
      try {
        console.log("Procesando persona:", persona.nombre);
        
        // PASO 1: Buscar/crear persona en tabla global
        let queryFind = `
          SELECT codpersona 
          FROM personas 
          WHERE LOWER(nombre) = LOWER(?)
        `;
        let paramsFind = [persona.nombre];
        
        if (persona.dni && persona.dni.trim() !== '') {
          queryFind = `
            SELECT codpersona 
            FROM personas 
            WHERE LOWER(nombre) = LOWER(?) OR dni = ?
          `;
          paramsFind = [persona.nombre, persona.dni];
        }
        
        const [existing] = await sequelize.query(queryFind, {
          replacements: paramsFind,
          type: sequelize.QueryTypes.SELECT,
          transaction: t
        });
        
        let codpersona;
        
        if (existing) {
          codpersona = existing.codpersona;
          ya_existian++;
          console.log(`Persona existente encontrada: ${codpersona}`);
        } else {
          // Crear nueva persona
          const [result] = await sequelize.query(
            `INSERT INTO personas (nombre, dni, telefono, email) 
             VALUES (?, ?, ?, ?)`,
            {
              replacements: [
                persona.nombre, 
                persona.dni || null, 
                persona.telefono || null, 
                persona.email || null
              ],
              type: sequelize.QueryTypes.INSERT,
              transaction: t
            }
          );
          codpersona = result;
          creadas++;
          console.log(`Nueva persona creada: ${codpersona}`);
        }
        
        // PASO 2: Asociar al club si no existe
        const [asociacionClub] = await sequelize.query(
          `SELECT cp.codclub 
           FROM clubes_personas cp 
           WHERE cp.codpersona = ? AND cp.codclub = ?`,
          {
            replacements: [codpersona, codclub],
            type: sequelize.QueryTypes.SELECT,
            transaction: t
          }
        );
        
        if (!asociacionClub) {
          await sequelize.query(
            `INSERT INTO clubes_personas (codpersona, codclub, tipo_usuario) 
             VALUES (?, ?, 2)`,
            {
              replacements: [codpersona, codclub],
              type: sequelize.QueryTypes.INSERT,
              transaction: t
            }
          );
          asociaciones_club_nuevas++;
          console.log(`Asociación club creada: ${codpersona} -> club ${codclub}`);
        } else {
          asociaciones_club_existentes++;
          console.log(`Asociación club ya existía: ${codpersona} -> club ${codclub}`);
        }
        
        // PASO 3: Asociar a la división con su rol
        // Verificar si ya está en esta división
        const [enDivision] = await sequelize.query(
          `SELECT codpersona 
           FROM personas_divisiones 
           WHERE codpersona = ? AND coddivision = ?`,
          {
            replacements: [codpersona, persona.coddivision],
            type: sequelize.QueryTypes.SELECT,
            transaction: t
          }
        );
        
        if (!enDivision) {
          // No está en la división, la agregamos
          await sequelize.query(
            `INSERT INTO personas_divisiones (codpersona, coddivision, codrol) 
             VALUES (?, ?, ?)`,
            {
              replacements: [codpersona, persona.coddivision, persona.codrol],
              type: sequelize.QueryTypes.INSERT,
              transaction: t
            }
          );
          asociaciones_division_nuevas++;
          console.log(`Asociación división creada: ${codpersona} -> división ${persona.coddivision} con rol ${persona.codrol}`);
        } else {
          // Ya está en la división, verificamos si hay que actualizar el rol
          asociaciones_division_existentes++;
          console.log(`Asociación división ya existía: ${codpersona} -> división ${persona.coddivision}`);
          
          // Opcional: actualizar el rol si es diferente
          // await sequelize.query(
          //   `UPDATE personas_division 
          //    SET codrol = ? 
          //    WHERE codpersona = ? AND coddivision = ?`,
          //   {
          //     replacements: [persona.codrol, codpersona, persona.coddivision],
          //     transaction: t
          //   }
          // );
        }
        
      } catch (error) {
        console.error("Error procesando persona:", persona.nombre, error);
        errores.push({
          persona: persona.nombre,
          dni: persona.dni,
          error: error.message
        });
      }
    }
    
    // Commit de la transacción
    await t.commit();
    
    // Preparar respuesta
    const respuesta = {
      creadas,
      ya_existian,
      asociaciones_club_nuevas,
      asociaciones_club_existentes,
      asociaciones_division_nuevas,
      asociaciones_division_existentes,
      total_procesadas: personas.length
    };
    
    if (errores.length > 0) {
      respuesta.errores = errores;
      respuesta.advertencia = `${errores.length} filas no se procesaron correctamente`;
    }
    
    console.log("Resultado importación:", respuesta);
    res.json(respuesta);
    
  } catch (error) {
    await t.rollback();
    console.error("Error en /importar_personas_masivo:", error);
    res.status(500).json({ error: error.message });
  }
});




app.post('/persona_guardar', verificarToken, async (req, res) => {

  const {
    codpersona,
    nombre,
    apodo,
    dni,
    fecha_nacimiento,
    telefono,
    email,
    usuario,
    clave,
    activo,
    estado,
    codclub,
    coddisciplina,
    divisiones = []
  } = req.body;

  const t = await sequelize.transaction();

  try {

    const codpersonaSafe = parseInt(codpersona) || 0;
    let personaId = codpersonaSafe;

    // ==========================
    // VALIDAR DNI DUPLICADO
    // ==========================

    if (dni) {

      const existente = await sequelize.query(
        `SELECT codpersona, nombre
         FROM personas
         WHERE dni = ? AND codpersona <> ?`,
        {
          replacements: [dni, codpersonaSafe],
          type: sequelize.QueryTypes.SELECT,
          transaction: t
        }
      );

      if (existente.length > 0) {

        await t.rollback();

        console.log("DNI duplicado:", dni, "->", existente[0]);

        return res.status(400).json({
          mensaje: `El DNI ${dni} ya está asignado a ${existente[0].nombre}`,
          codpersona_existente: existente[0].codpersona
        });

      }

    }

    // ==========================
    // VALIDAR USUARIO DUPLICADO
    // ==========================

    if (usuario) {

      const usuarioExistente = await sequelize.query(
        `SELECT codpersona, nombre
         FROM personas
         WHERE usuario = ? AND codpersona <> ?`,
        {
          replacements: [usuario, codpersonaSafe],
          type: sequelize.QueryTypes.SELECT,
          transaction: t
        }
      );

      if (usuarioExistente.length > 0) {

        await t.rollback();

        console.log("Usuario duplicado:", usuario, "->", usuarioExistente[0]);

        return res.status(400).json({
          mensaje: `El usuario ya pertenece a ${usuarioExistente[0].nombre}`,
          codpersona_existente: usuarioExistente[0].codpersona
        });

      }

    }

    // ==========================
    // CREAR PERSONA
    // ==========================

    if (codpersonaSafe === 0) {

      const [result] = await sequelize.query(
        `INSERT INTO personas 
        (nombre, apodo, dni, fecha_nacimiento, telefono, email, usuario, clave, activo, estado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        {
          replacements: [
            nombre,
            apodo || null,
            dni || null,
            fecha_nacimiento || null,
            telefono || null,
            email || null,
            usuario || null,
            clave || null,
            activo ?? 1,
            estado ?? 1
          ],
          type: sequelize.QueryTypes.INSERT,
          transaction: t
        }
      );

      personaId = result;

    } else {

      // ==========================
      // EDITAR PERSONA
      // ==========================

      if (clave) {

        await sequelize.query(
          `UPDATE personas
           SET nombre=?,
               apodo=?,
               dni=?,
               fecha_nacimiento=?,
               telefono=?,
               email=?,
               usuario=?,
               clave=?,
               activo=?,
               estado=?
           WHERE codpersona=?`,
          {
            replacements: [
              nombre,
              apodo || null,
              dni || null,
              fecha_nacimiento || null,
              telefono || null,
              email || null,
              usuario || null,
              clave,
              activo ?? 1,
              estado ?? 1,
              codpersonaSafe
            ],
            transaction: t
          }
        );

      } else {

        await sequelize.query(
          `UPDATE personas
           SET nombre=?,
               apodo=?,
               dni=?,
               fecha_nacimiento=?,
               telefono=?,
               email=?,
               usuario=?,
               activo=?,
               estado=?
           WHERE codpersona=?`,
          {
            replacements: [
              nombre,
              apodo || null,
              dni || null,
              fecha_nacimiento || null,
              telefono || null,
              email || null,
              usuario || null,
              activo ?? 1,
              estado ?? 1,
              codpersonaSafe
            ],
            transaction: t
          }
        );

      }

    }

    // ==========================
    // ASOCIAR AL CLUB
    // ==========================

    const existeClub = await sequelize.query(
      `SELECT codpersona
       FROM clubes_personas
       WHERE codpersona = ? AND codclub = ?`,
      {
        replacements: [personaId, codclub],
        type: sequelize.QueryTypes.SELECT,
        transaction: t
      }
    );

    if (existeClub.length === 0) {

      await sequelize.query(
        `INSERT INTO clubes_personas (codpersona, codclub, tipo_usuario)
         VALUES (?, ?, 2)`,
        {
          replacements: [personaId, codclub],
          type: sequelize.QueryTypes.INSERT,
          transaction: t
        }
      );

    }

    // ==========================
    // DIVISIONES
    // ==========================

    await sequelize.query(
      `DELETE FROM personas_divisiones
       WHERE codpersona = ?`,
      {
        replacements: [personaId],
        transaction: t
      }
    );

    for (const div of divisiones) {

      if (!div.coddivision) continue;

      await sequelize.query(
        `INSERT INTO personas_divisiones
        (codpersona, coddivision, codrol)
        VALUES (?, ?, ?)`,
        {
          replacements: [
            personaId,
            div.coddivision,
            div.codrol || null
          ],
          type: sequelize.QueryTypes.INSERT,
          transaction: t
        }
      );

    }

    await t.commit();

    res.json({
      mensaje: "Persona guardada correctamente",
      codpersona: personaId
    });

  } catch (error) {

    await t.rollback();

    console.error("Error en persona_guardar:", error);

    res.status(500).json({
      error: error.message
    });

  }

});
app.post('/personas_club', verificarToken, async (req, res) => { 
  const { codclub, coddisciplina, filtro, soloSinDivision } = req.body; // 👈 Agregamos soloSinDivision

  if (!codclub) {
    return res.status(400).json({ mensaje: 'Falta codclub' });
  }

  try {

    let whereConditions = `
      WHERE p.estado <> 6 
      AND cp.codclub = :codclub
    `;

    let replacements = { codclub };

    if (coddisciplina) {
      whereConditions += ` 
        AND EXISTS (
          SELECT 1 
          FROM personas_disciplinas pd2 
          WHERE pd2.codpersona = p.codpersona 
          AND pd2.coddisciplina = :coddisciplina
        )
      `;
      replacements.coddisciplina = coddisciplina;
    }

    if (filtro) {
      whereConditions += ` AND p.nombre LIKE :filtro`;
      replacements.filtro = `%${filtro}%`;
    }

    // 🔹 NUEVO: Filtrar personas que NO están en ninguna división
    if (soloSinDivision) {
      whereConditions += ` 
        AND NOT EXISTS (
          SELECT 1 
          FROM personas_divisiones pd3 
          WHERE pd3.codpersona = p.codpersona
        )
      `;
    }

    const query = `
      SELECT 
          p.codpersona,
          p.nombre,
          p.apodo,
          c.codclub,
          c.descripcion AS club,

          -- Disciplinas en JSON
          (
            SELECT JSON_ARRAYAGG(
              JSON_OBJECT(
                'coddisciplina', dis.coddisciplina,
                'descripcion', dis.descripcion
              )
            )
            FROM personas_disciplinas pd2
            INNER JOIN disciplinas dis 
              ON dis.coddisciplina = pd2.coddisciplina
            WHERE pd2.codpersona = p.codpersona
          ) AS disciplinas,

          -- Divisiones en JSON
          (
            SELECT JSON_ARRAYAGG(
              JSON_OBJECT(
                'coddivision', d.coddivision,
                'descripcion', d.descripcion
              )
            )
            FROM personas_divisiones pd
            INNER JOIN divisiones d 
              ON d.coddivision = pd.coddivision
            WHERE pd.codpersona = p.codpersona
          ) AS divisiones

      FROM personas p

      INNER JOIN clubes_personas cp 
          ON cp.codpersona = p.codpersona

      INNER JOIN clubes c 
          ON c.codclub = cp.codclub

      ${whereConditions}

      ORDER BY p.nombre
    `;

    
    const rows = await sequelize.query(query, {
      replacements,
      type: sequelize.QueryTypes.SELECT
    });

    res.json(rows);

  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error interno' });
  }
});

// ===================================================
// 4) PERSONAS POR DIVISIÓN
// ===================================================
// body:
// { coddivision: [14, 13] }
// o { coddivision: [14] }

// ===================================================
// REGISTRAR O ELIMINAR ASISTENCIA A ACTIVIDAD
// ===================================================
app.post('/actividad_asistencia', verificarToken, async (req, res) => {
  const { codasistencia, codclub, codactividad, codpersona, fecha, observacion, estado } = req.body;

  try {
    // CASO 1: UPDATE (baja lógica)
    if (codasistencia && parseInt(codasistencia) > 0) {
      
      const [existente] = await sequelize.query(
        `SELECT codasistencia FROM actividades_asistencia 
         WHERE codasistencia = :codasistencia`,
        { replacements: { codasistencia }, type: sequelize.QueryTypes.SELECT }
      );

      if (!existente) {
        return res.status(404).json({ mensaje: 'El registro de asistencia no existe' });
      }

      await sequelize.query(
        `UPDATE actividades_asistencia 
         SET estado = :estado
         WHERE codasistencia = :codasistencia`,
        { replacements: { estado: estado || 'B', codasistencia }, type: sequelize.QueryTypes.UPDATE }
      );

      return res.json({ mensaje: 'Asistencia actualizada correctamente', codasistencia, accion: 'UPDATE' });
    }

    // CASO 2: INSERT
    else {
      if (!codclub) return res.status(400).json({ mensaje: 'Falta codclub' });
      if (!codactividad) return res.status(400).json({ mensaje: 'Falta codactividad' });
      if (!codpersona) return res.status(400).json({ mensaje: 'Falta codpersona' });
      if (!fecha) return res.status(400).json({ mensaje: 'Falta fecha' });

      // 🔥 CORRECCIÓN: NO convertir, guardar tal cual viene del frontend
      // El frontend ya manda UTC con formato "YYYY-MM-DD HH:MM:SS"
      const fechaUTC = fecha; // Así nomás, sin tocar

      console.log('📅 Fecha recibida (ya UTC):', fechaUTC);

      const [result] = await sequelize.query(
        `INSERT INTO actividades_asistencia 
         (codactividad, codclub, codpersona, fecha, observacion, estado) 
         VALUES 
         (:codactividad, :codclub, :codpersona, :fecha, :observacion, 'A')`,
        {
          replacements: { 
            codactividad, 
            codclub, 
            codpersona, 
            fecha: fechaUTC, // ← Guardar tal cual
            observacion: observacion || null 
          },
          type: sequelize.QueryTypes.INSERT
        }
      );

      return res.json({ mensaje: 'Asistencia registrada correctamente', codasistencia: result, accion: 'INSERT' });
    }

  } catch (error) {
    console.error('Error en actividad_asistencia:', error);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
});


app.post('/personas_jugadores_actividades', verificarToken, async (req, res) => {
  let { codclub, coddivision, coddisciplina, codactividad, filtro } = req.body;

  console.log("filtro: ", filtro);

  if (!codclub)
    return res.status(400).json({ mensaje: 'Falta codclub' });

  if (!coddisciplina)
    return res.status(400).json({ mensaje: 'Falta coddisciplina' });

  if (!codactividad)
    return res.status(400).json({ mensaje: 'Falta codactividad' });

  try {
    // ===== CONSULTA 1: TRAER TODAS LAS PERSONAS =====
    let queryPersonas = `
      SELECT 
        p.codpersona,
        p.nombre,
        p.apodo,
        d.descripcion AS division,
        r.descripcion AS rol
      FROM personas_divisiones pd
      INNER JOIN personas p ON p.codpersona = pd.codpersona
      INNER JOIN divisiones d ON d.coddivision = pd.coddivision
      INNER JOIN roles r ON r.codrol = pd.codrol
      WHERE p.estado <> 6
        AND d.estado = 'A'
        AND pd.codrol = 1  -- Solo jugadores
        AND d.codclub = :codclub
        AND d.coddisciplina = :coddisciplina
    `;

    const replacementsPersonas = {
      codclub,
      coddisciplina
    };

    // 🔹 Filtrar por división (solo si NO hay filtro de nombre)
    if (!filtro || filtro.trim() === "") {
      if (coddivision && coddivision !== 0) {
        if (!Array.isArray(coddivision))
          coddivision = [coddivision];

        queryPersonas += ` AND pd.coddivision IN (:coddivision)`;
        replacementsPersonas.coddivision = coddivision;
      }
    }

    // 🔹 Filtro por nombre/apodo (si hay)
    if (filtro && filtro.trim() !== "") {
      queryPersonas += `
        AND (
          LOWER(p.nombre) LIKE LOWER(:filtro)
          OR LOWER(p.apodo) LIKE LOWER(:filtro)
        )
      `;
      replacementsPersonas.filtro = `%${filtro}%`;
    }

    queryPersonas += ` ORDER BY p.apodo, p.nombre`;

    // Ejecutar consulta de personas
    const personas = await sequelize.query(queryPersonas, {
      replacements: replacementsPersonas,
      type: sequelize.QueryTypes.SELECT
    });

    // Si no hay personas, devolver array vacío
    if (personas.length === 0) {
      return res.json([]);
    }

    // ===== CONSULTA 2: TRAER TODAS LAS ASISTENCIAS DE UNA SOLA VEZ =====
    const codpersonas = personas.map(p => p.codpersona);
    
    const queryAsistencias = `
      SELECT 
        codpersona,
        -- Asistencias en la semana actual
        SUM(CASE 
            WHEN YEARWEEK(fecha, 1) = YEARWEEK(CURDATE(), 1) 
            THEN 1 ELSE 0 
        END) AS asistencias_semana,
        -- Fecha de última asistencia
        MAX(fecha) AS fecha_ult_asistencia,
        -- Código de la última asistencia
        SUBSTRING_INDEX(
            GROUP_CONCAT(codasistencia ORDER BY fecha DESC SEPARATOR ','), 
            ',', 1
        ) AS codultima_asistencia,
        -- Semáforo de la última asistencia
        SUBSTRING_INDEX(
            GROUP_CONCAT(semaforo ORDER BY fecha DESC SEPARATOR ','), 
            ',', 1
        ) AS semaforo_ult_asistencia
      FROM actividades_asistencia
      WHERE codactividad = :codactividad 
        AND estado = 'A'
        AND codpersona IN (:codpersonas)
        AND fecha >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)  -- Último año para eficiencia
      GROUP BY codpersona
    `;

    const asistencias = await sequelize.query(queryAsistencias, {
      replacements: { 
        codactividad, 
        codpersonas 
      },
      type: sequelize.QueryTypes.SELECT
    });

    // ===== COMBINAR RESULTADOS EN JS (SUPER RÁPIDO) =====
    const asistenciasMap = new Map(
      asistencias.map(a => [a.codpersona, a])
    );

    const resultado = personas.map(p => {
      const asis = asistenciasMap.get(p.codpersona) || {};
      
      // Extraer solo el primer valor si hay múltiples (por si acaso)
      let semaforo = asis.semaforo_ult_asistencia;
      if (semaforo && semaforo.includes(',')) {
        semaforo = semaforo.split(',')[0];
      }
      
      let codasistencia = asis.codultima_asistencia;
      if (codasistencia && codasistencia.includes(',')) {
        codasistencia = codasistencia.split(',')[0];
      }

      return {
        ...p,
        asistencias_semana: Number(asis.asistencias_semana) || 0,
        fecha_ult_asistencia: asis.fecha_ult_asistencia || null,
        codultima_asistencia: codasistencia || null,
        semaforo_ult_asistencia: semaforo || null
      };
    });

    console.log(`✅ Encontradas ${resultado.length} personas`);
    res.json(resultado);

  } catch (error) {
    console.error('❌ Error en personas_jugadores_actividades:', error);
    res.status(500).json({ mensaje: 'Error interno' });
  }
});

app.post('/personas_jugadores_actividadesOld', verificarToken, async (req, res) => {
  let { codclub, coddivision, coddisciplina, codactividad, filtro } = req.body;

  console.log("filtro: ", filtro );

  if (!codclub)
    return res.status(400).json({ mensaje: 'Falta codclub' });

  if (!coddisciplina)
    return res.status(400).json({ mensaje: 'Falta coddisciplina' });

  if (!codactividad)
    return res.status(400).json({ mensaje: 'Falta codactividad' });

  try {
    let query = `
      SELECT 
        p.codpersona,
        p.nombre,
        p.apodo,
        d.descripcion AS division,
        r.descripcion AS rol,
        -- Contar asistencias de la semana actual
        (
            SELECT COUNT(*) 
            FROM actividades_asistencia aa 
            WHERE aa.codpersona = p.codpersona 
                AND aa.codactividad = :codactividad
                AND aa.estado = 'A'
                AND YEARWEEK(aa.fecha, 1) = YEARWEEK(CURDATE(), 1)
        ) AS asistencias_semana,
        -- Última fecha de asistencia (la más reciente)
        (
            SELECT MAX(aa.fecha)
            FROM actividades_asistencia aa 
            WHERE aa.codpersona = p.codpersona 
                AND aa.codactividad = :codactividad
                AND aa.estado = 'A'
        ) AS fecha_ult_asistencia
      FROM personas_divisiones pd
      INNER JOIN personas p ON p.codpersona = pd.codpersona
      INNER JOIN divisiones d ON d.coddivision = pd.coddivision
      INNER JOIN roles r ON r.codrol = pd.codrol
      WHERE p.estado <> 6
          AND d.estado = 'A'
          AND pd.codrol = 1  -- Solo jugadores
          AND d.codclub = :codclub
          AND d.coddisciplina = :coddisciplina
    `;

    const replacements = {
      codclub,
      coddisciplina,
      codactividad  // ✅ AGREGADO: faltaba esto
    };

    // 🔹 Filtrar división solo si != 0
    if (filtro && filtro.trim() !== ""){

      console.log("Filtrando por nombre o apodo en todas las divisiones");

    } else {
        
      if (coddivision && coddivision !== 0) {
        if (!Array.isArray(coddivision))
          coddivision = [coddivision];

        query += ` AND pd.coddivision IN (:coddivision)`;
        replacements.coddivision = coddivision;
      }}

    // 🔹 Filtro nombre/apodo
    if (filtro && filtro.trim() !== "") {
      query += `
        AND (
          LOWER(p.nombre) LIKE LOWER(:filtro)
          OR LOWER(p.apodo) LIKE LOWER(:filtro)
        )
      `;
      replacements.filtro = `%${filtro}%`;
    }

    query += ` ORDER BY p.apodo, p.nombre`;

    const rows = await sequelize.query(query, {
      replacements,
      type: sequelize.QueryTypes.SELECT
    });

    res.json(rows);

  } catch (error) {
    console.error('❌ Error en personas_jugadores_actividades:', error);
    res.status(500).json({ mensaje: 'Error interno' });
  }
});



app.post('/asistencias_por_semana', verificarToken, async (req, res) => {
  const { codpersona, codactividad, dias = 60 } = req.body;
  
  if (!codpersona) return res.status(400).json({ mensaje: 'Falta codpersona' });
  if (!codactividad) return res.status(400).json({ mensaje: 'Falta codactividad' });

  try {
    const rows = await sequelize.query(`
      SELECT 
        YEARWEEK(aa.fecha, 1) as semana_id,
        -- Usamos MIN/MAX para que MySQL no se queje
        MIN(DATE_FORMAT(DATE_SUB(aa.fecha, INTERVAL WEEKDAY(aa.fecha) DAY), '%d/%m')) as semana_inicio,
        MAX(DATE_FORMAT(DATE_ADD(aa.fecha, INTERVAL (6 - WEEKDAY(aa.fecha)) DAY), '%d/%m')) as semana_fin,
        COUNT(*) as asistencias
      FROM actividades_asistencia aa
      WHERE aa.codpersona = :codpersona
        AND aa.codactividad = :codactividad
        AND aa.estado = 'A'
        AND aa.fecha >= DATE_SUB(CURDATE(), INTERVAL :dias DAY)
      GROUP BY YEARWEEK(aa.fecha, 1)
      ORDER BY semana_id DESC
      LIMIT 10
    `, {
      replacements: { codpersona, codactividad, dias },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({
      semanas: rows,
      total_asistencias: rows.reduce((acc, s) => acc + s.asistencias, 0),
      dias_consultados: dias
    });

  } catch (error) {
    console.error('Error en asistencias_por_semana:', error);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
});
app.post('/asistencia_actividad_actualizar_semaforo', verificarToken, async (req, res) => {
  const { codasistencia, semaforo } = req.body;
  
  if (!codasistencia || !semaforo) {
    return res.status(400).json({ error: 'Faltan datos' });
  }
  
  if (!['V', 'A', 'R'].includes(semaforo)) {
    return res.status(400).json({ error: 'Valor inválido' });
  }

  try {
    await sequelize.query(`
      UPDATE actividades_asistencia 
      SET semaforo = :semaforo 
      WHERE codasistencia = :codasistencia
    `, {
      replacements: { codasistencia, semaforo },
      type: sequelize.QueryTypes.UPDATE
    });

    res.json({ success: true });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/historial_asistencias', verificarToken, async (req, res) => {
  const { codpersona, codactividad, fecha_desde, fecha_hasta } = req.body;
  
  if (!codpersona) return res.status(400).json({ mensaje: 'Falta codpersona' });
  if (!codactividad) return res.status(400).json({ mensaje: 'Falta codactividad' });
  if (!fecha_desde || !fecha_hasta) {
    return res.status(400).json({ mensaje: 'Faltan fechas' });
  }

  // 🔥 Función para convertir YYYYMMDDHHmmss → YYYY-MM-DD HH:mm:ss
  const formatearFecha = (fecha) => {
    if (typeof fecha !== 'string' || !/^\d{14}$/.test(fecha)) {
      throw new Error(`Formato de fecha inválido: ${fecha}`);
    }

    return `${fecha.slice(0,4)}-${fecha.slice(4,6)}-${fecha.slice(6,8)} ` +
           `${fecha.slice(8,10)}:${fecha.slice(10,12)}:${fecha.slice(12,14)}`;
  };

  try {
    const fechaDesdeSQL = formatearFecha(fecha_desde);
    const fechaHastaSQL = formatearFecha(fecha_hasta);

    console.log('📅 Fecha desde:', fechaDesdeSQL);
    console.log('📅 Fecha hasta:', fechaHastaSQL);

    const rows = await sequelize.query(`
      SELECT 
        aa.codasistencia,
        aa.fecha as fecha,  -- 🔥 CAMBIADO: devolver la fecha original en UTC
        DAYNAME(aa.fecha) as dia_semana,
        aa.semaforo,
        aa.estado,
        aa.observacion                
      FROM actividades_asistencia aa
      WHERE aa.codpersona = :codpersona
        AND aa.codactividad = :codactividad
        AND aa.estado = 'A'
        AND aa.fecha >= :fecha_desde
        AND aa.fecha <= :fecha_hasta
      ORDER BY aa.fecha DESC
    `, {
      replacements: { 
        codpersona, 
        codactividad, 
        fecha_desde: fechaDesdeSQL,
        fecha_hasta: fechaHastaSQL
      },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({
      asistencias: rows,
      total: rows.length
    });

  } catch (error) {
    console.error('❌ Error en historial_asistencias:', error);
    res.status(500).json({ 
      mensaje: 'Error interno del servidor',
      error: error.message
    });
  }
});
app.post('/personas_division', verificarToken, async (req, res) => {
  let { coddivision } = req.body;

  if (!coddivision)
    return res.status(400).json({ mensaje: 'Falta coddivision' });

  // 🔹 Aseguramos array
  if (!Array.isArray(coddivision)) {
    coddivision = [coddivision];
  }

  try {
    // Log para ver los parámetros
    console.log('📥 Parámetros recibidos:', { coddivision });

    // Construir la consulta con logging personalizado
    const rows = await sequelize.query(
      `
      SELECT 
        p.codpersona,
        p.nombre, p.fecha_nacimiento, p.estado,
        p.apodo,
        d.descripcion AS division,
        r.descripcion AS rol
      FROM personas_divisiones pd
      INNER JOIN personas p ON p.codpersona = pd.codpersona
      INNER JOIN divisiones d ON d.coddivision = pd.coddivision
      INNER JOIN roles r ON r.codrol = pd.codrol
      WHERE pd.coddivision IN (:coddivision)
        AND p.estado <> 6
        AND d.estado = 'A'
      ORDER BY 
          CASE pd.codrol
            WHEN 2 THEN 1
            WHEN 3 THEN 2
            WHEN 4 THEN 3
            WHEN 5 THEN 4
            WHEN 1 THEN 5
            ELSE 6
          END,
          d.descripcion
      `,
      {
        replacements: { coddivision },
        type: sequelize.QueryTypes.SELECT,
        logging: (sql) => {
          console.log('🔍 SQL EJECUTADO:');
          console.log(sql);
          console.log('📌 Con parámetros:', coddivision);
        }
      }
    );
    
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error interno' });
  }
});





app.post('/historial_asistencia_actividadesOld16042026', verificarToken, async (req, res) => {
  const { 
    coddivisiones,
    codactividad, 
    fecha_desde,
    fecha_hasta,
    codpersona
  } = req.body;

  console.log("FECHADESDE**", fecha_desde);
  console.log("FECHAHASTA**", fecha_hasta);

  if (!codactividad) {
    return res.status(400).json({ mensaje: 'Falta codactividad' });
  }

  if (!fecha_desde || !fecha_hasta) {
    return res.status(400).json({ mensaje: 'Faltan fechas' });
  }

  const formatearFecha = (fecha) => {
    if (typeof fecha !== 'string') {
      throw new Error(`Formato de fecha inválido: ${fecha}`);
    }

    // YYYY-MM-DD HH:mm:ss
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(fecha)) {
      return fecha;
    }

    // YYYYMMDDHHmmss
    if (/^\d{14}$/.test(fecha)) {
      return `${fecha.slice(0,4)}-${fecha.slice(4,6)}-${fecha.slice(6,8)} ` +
             `${fecha.slice(8,10)}:${fecha.slice(10,12)}:${fecha.slice(12,14)}`;
    }

    throw new Error(`Formato de fecha inválido: ${fecha}`);
  };

  try {
    const fechaDesdeSQL = formatearFecha(fecha_desde);
    const fechaHastaSQL = formatearFecha(fecha_hasta);

    console.log('📅 Fecha desde:', fechaDesdeSQL);
    console.log('📅 Fecha hasta:', fechaHastaSQL);

    if (fechaDesdeSQL > fechaHastaSQL) {
      return res.status(400).json({ 
        mensaje: 'La fecha_desde no puede ser mayor que fecha_hasta'
      });
    }

    // 🔥 QUERY SIMPLE (SIN AGRUPAR)
    let sql = `
      SELECT 
        aa.codpersona,
        aa.fecha
      FROM actividades_asistencia aa
      WHERE aa.codactividad = :codactividad
        AND aa.estado = 'A'
        AND aa.fecha >= :fecha_desde
        AND aa.fecha <= :fecha_hasta
    `;

    const replacements = {
      codactividad,
      fecha_desde: fechaDesdeSQL,
      fecha_hasta: fechaHastaSQL
    };

    if (codpersona) {
      sql += ` AND aa.codpersona = :codpersona`;
      replacements.codpersona = codpersona;
    }

    if (coddivisiones && coddivisiones.length > 0) {
      sql += `
        AND aa.codpersona IN (
          SELECT codpersona 
          FROM personas_divisiones 
          WHERE coddivision IN (:coddivisiones)
        )
      `;
      replacements.coddivisiones = coddivisiones;
    }

    sql += ` ORDER BY aa.fecha ASC`;

    console.log("🧾 SQL:", sql);

    const rows = await sequelize.query(sql, {
      replacements,
      type: sequelize.QueryTypes.SELECT
    });

    console.log(`✅ Registros obtenidos: ${rows.length}`);

    // 🔥 RESPUESTA SIMPLE
    res.json({
      detalle: rows
    });

  } catch (error) {
    console.error('❌ Error en historial_asistencia_actividades:', error);
    res.status(500).json({ 
      mensaje: 'Error interno',
      error: error.message 
    });
  }
});

app.post('/historial_asistencia_actividades', verificarToken, async (req, res) => {
  const { 
    coddivisiones,
    codactividad, 
    fecha_desde,
    fecha_hasta,
    codpersona
  } = req.body;

  console.log("FECHADESDE**", fecha_desde);
  console.log("FECHAHASTA**", fecha_hasta);

  if (!codactividad) {
    return res.status(400).json({ mensaje: 'Falta codactividad' });
  }

  if (!fecha_desde || !fecha_hasta) {
    return res.status(400).json({ mensaje: 'Faltan fechas' });
  }

  const formatearFecha = (fecha) => {
    if (typeof fecha !== 'string') {
      throw new Error(`Formato de fecha inválido: ${fecha}`);
    }

    // YYYY-MM-DD HH:mm:ss
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(fecha)) {
      return fecha;
    }

    // YYYYMMDDHHmmss
    if (/^\d{14}$/.test(fecha)) {
      return `${fecha.slice(0,4)}-${fecha.slice(4,6)}-${fecha.slice(6,8)} ` +
             `${fecha.slice(8,10)}:${fecha.slice(10,12)}:${fecha.slice(12,14)}`;
    }

    throw new Error(`Formato de fecha inválido: ${fecha}`);
  };

  try {
    const fechaDesdeSQL = formatearFecha(fecha_desde);
    const fechaHastaSQL = formatearFecha(fecha_hasta);

    console.log('📅 Fecha desde:', fechaDesdeSQL);
    console.log('📅 Fecha hasta:', fechaHastaSQL);

    if (fechaDesdeSQL > fechaHastaSQL) {
      return res.status(400).json({ 
        mensaje: 'La fecha_desde no puede ser mayor que fecha_hasta'
      });
    }

    // 🔥 QUERY CON JOIN PARA TRAER NOMBRE Y APODO
    let sql = `
      SELECT 
        aa.codpersona,
        p.nombre,
        p.apodo,
        aa.fecha
      FROM actividades_asistencia aa
      INNER JOIN personas p ON p.codpersona = aa.codpersona
      WHERE aa.codactividad = :codactividad
        AND aa.estado = 'A'
        AND aa.fecha >= :fecha_desde
        AND aa.fecha <= :fecha_hasta
    `;

    const replacements = {
      codactividad,
      fecha_desde: fechaDesdeSQL,
      fecha_hasta: fechaHastaSQL
    };

    if (codpersona) {
      sql += ` AND aa.codpersona = :codpersona`;
      replacements.codpersona = codpersona;
    }

    if (coddivisiones && coddivisiones.length > 0) {
      sql += `
        AND aa.codpersona IN (
          SELECT codpersona 
          FROM personas_divisiones 
          WHERE coddivision IN (:coddivisiones)
        )
      `;
      replacements.coddivisiones = coddivisiones;
    }

    sql += ` ORDER BY aa.fecha ASC`;

    console.log("🧾 SQL:", sql);

    const rows = await sequelize.query(sql, {
      replacements,
      type: sequelize.QueryTypes.SELECT
    });

    console.log(`✅ Registros obtenidos: ${rows.length}`);

    // 🔥 RESPUESTA CON NOMBRE Y APODO
    res.json({
      detalle: rows
    });

  } catch (error) {
    console.error('❌ Error en historial_asistencia_actividades:', error);
    res.status(500).json({ 
      mensaje: 'Error interno',
      error: error.message 
    });
  }
});





app.post('/divisiones_persona', async (req, res) => {
  const { codpersona, coddisciplina, codclub } = req.body;

  if (!codpersona || !coddisciplina || !codclub) {
    return res.status(400).json({ mensaje: 'Faltan parámetros' });
  }

  try {
    const rows = await sequelize.query(
      `SELECT di.coddivision, di.descripcion
       FROM divisiones di
       INNER JOIN personas_divisiones pd ON di.coddivision = pd.coddivision
       WHERE pd.codpersona = :codpersona
         AND pd.estado = 'A'
         AND di.estado = 'A'
         AND di.coddisciplina = :coddisciplina
         AND di.codclub = :codclub`,
      {
        replacements: { codpersona, coddisciplina, codclub },
        type: sequelize.QueryTypes.SELECT
      }
    );

    res.json(rows);
  } catch (err) {
    console.error("Error en /divisiones_persona:", err);
    res.status(500).json({ mensaje: 'Error interno', error: err.message });
  }
});




app.post('/asistencias_divisiones', async (req, res) => {
  const { fecha_desde, fecha_hasta, coddivisiones, codpersona } = req.body;

  if (!fecha_desde || !fecha_hasta) {
    return res.status(400).json({ mensaje: 'Faltan fechas' });
  }

  if (!Array.isArray(coddivisiones) || coddivisiones.length === 0) {
    return res.status(400).json({ mensaje: 'Faltan divisiones' });
  }

  try {
    // Construimos la condición de divisiones y persona
    let whereDivision = '';
    let wherePersona = '';
    const replacements = { 
      fecha_desde, 
      fecha_hasta 
    };

    if (Array.isArray(coddivisiones) && coddivisiones.length > 0) {
      whereDivision = 'AND dd.coddivision IN (:coddivisiones)';
      replacements.coddivisiones = coddivisiones;
    }

    if (codpersona) {
      wherePersona = 'AND p.codpersona = :codpersona';
      replacements.codpersona = codpersona;
    }

    // Consulta SQL completa con parámetros
    const sqlQuery = `
      WITH ranked_events AS (
        SELECT 
            e.codevento,
            e.fecha,
            dd.coddivision,
            p.codpersona,
            p.nombre,
            p.apodo,
            d.asistencia AS codigo_asistencia,
            CASE d.asistencia
                WHEN 'P'  THEN 'Presente'
                WHEN 'PN' THEN 'Presente no entrena'
                WHEN 'A'  THEN 'Ausente con aviso'
                WHEN 'AA' THEN 'Ausente sin aviso'
                ELSE 'Desconocido'
            END AS asistencia,
            CASE e.estado
                WHEN 'A' THEN 'ACTIVO'
                WHEN 'B' THEN 'BAJA'
                WHEN 'F' THEN 'FINALIZADO'
                WHEN 'S' THEN 'SUSPENDIDO'
            END AS estado_evento,
            r.descripcion rol,
            ROW_NUMBER() OVER (PARTITION BY e.codevento, p.codpersona ORDER BY dd.coddivision) AS rn
        FROM eventos e
        INNER JOIN det_evento d ON d.codevento = e.codevento
        INNER JOIN det_evento_division dd ON dd.codevento = e.codevento
        INNER JOIN personas p ON p.codpersona = d.codpersona
        INNER JOIN personas_divisiones pdv ON pdv.coddivision = dd.coddivision AND pdv.codpersona = p.codpersona
        LEFT JOIN roles r ON r.codrol = pdv.codrol
        WHERE e.fecha BETWEEN :fecha_desde AND :fecha_hasta
            ${whereDivision}
            ${wherePersona}
            AND r.descripcion = 'Jugador' 
            AND e.estado = 'F' 
            AND p.estado <> 6
      )
      SELECT 
          codevento,
          fecha,
          coddivision,
          codpersona,
          nombre,
          apodo,
          codigo_asistencia,
          asistencia,
          estado_evento,
          rol
      FROM ranked_events
      WHERE rn = 1
      ORDER BY nombre
    `;

    // Imprimir la consulta con los valores reales (solo una vez)
    console.log('\n=== CONSULTA SQL CON VALORES REALES ===');
    
    let sqlParaMostrar = sqlQuery;
    
    // Reemplazar :fecha_desde y :fecha_hasta
    sqlParaMostrar = sqlParaMostrar.replace(':fecha_desde', `'${fecha_desde}'`);
    sqlParaMostrar = sqlParaMostrar.replace(':fecha_hasta', `'${fecha_hasta}'`);
    
    // Reemplazar :coddivisiones si existe
    if (coddivisiones && coddivisiones.length > 0) {
      const divisionesStr = coddivisiones.map(d => d).join(', ');
      sqlParaMostrar = sqlParaMostrar.replace(':coddivisiones', divisionesStr);
    }
    
    // Reemplazar :codpersona si existe
    if (codpersona) {
      sqlParaMostrar = sqlParaMostrar.replace(':codpersona', codpersona);
    }

    console.log(sqlParaMostrar);
    console.log('=======================================\n');
    
    // Ejecutar la consulta con logging condicional
    let queryEjecutada = false;
    
    const rows = await sequelize.query(
      sqlQuery,
      {
        replacements,
        type: sequelize.QueryTypes.SELECT,
        logging: (sql) => {
          if (!queryEjecutada) {
            console.log('\n🔍 SQL EJECUTADO POR SEQUELIZE:');
            console.log(sql);
            console.log('=======================================\n');
            queryEjecutada = true;
          }
        }
      }
    );

    console.log(`✅ Resultados obtenidos: ${rows.length} registros`);
    res.json(rows);

  } catch (err) {
    console.error('❌ Error en /asistencias_divisiones:', err);
    res.status(500).json({
      mensaje: 'Error interno',
      error: err.message
    });
  }
});

app.post('/asistencias_divisionesOld', async (req, res) => {
  const { fecha_desde, fecha_hasta, coddivisiones } = req.body;

  if (!fecha_desde || !fecha_hasta) {
    return res.status(400).json({ mensaje: 'Faltan fechas' });
  }

  if (!Array.isArray(coddivisiones) || coddivisiones.length === 0) {
    return res.status(400).json({ mensaje: 'Faltan divisiones' });
  }

  try {
    // Construimos la condición de divisiones
    let whereDivision = '';
    const replacements = { 
      fecha_desde, 
      fecha_hasta 
    };

    if (Array.isArray(coddivisiones) && coddivisiones.length > 0) {
      whereDivision = 'AND dd.coddivision IN (:coddivisiones)';
      replacements.coddivisiones = coddivisiones;
    }

    // Consulta SQL completa con parámetros
    const sqlQuery = `
      WITH ranked_events AS (
        SELECT 
            e.codevento,
            e.fecha,
            dd.coddivision,
            p.codpersona,
            p.nombre,
            p.apodo,
            d.asistencia AS codigo_asistencia,
            CASE d.asistencia
                WHEN 'P'  THEN 'Presente'
                WHEN 'PN' THEN 'Presente no entrena'
                WHEN 'A'  THEN 'Ausente con aviso'
                WHEN 'AA' THEN 'Ausente sin aviso'
                ELSE 'Desconocido'
            END AS asistencia,
            CASE e.estado
                WHEN 'A' THEN 'ACTIVO'
                WHEN 'B' THEN 'BAJA'
                WHEN 'F' THEN 'FINALIZADO'
                WHEN 'S' THEN 'SUSPENDIDO'
            END AS estado_evento,
            r.descripcion rol,
            ROW_NUMBER() OVER (PARTITION BY e.codevento, p.codpersona ORDER BY dd.coddivision) AS rn
        FROM eventos e
        INNER JOIN det_evento d ON d.codevento = e.codevento
        INNER JOIN det_evento_division dd ON dd.codevento = e.codevento
        INNER JOIN personas p ON p.codpersona = d.codpersona
        INNER JOIN personas_divisiones pdv ON pdv.coddivision = dd.coddivision AND pdv.codpersona = p.codpersona
        LEFT JOIN roles r ON r.codrol = pdv.codrol
        WHERE e.fecha BETWEEN :fecha_desde AND :fecha_hasta
            ${whereDivision}
            AND r.descripcion = 'Jugador' 
            AND e.estado = 'F' 
            AND p.estado <> 6
      )
      SELECT 
          codevento,
          fecha,
          coddivision,
          codpersona,
          nombre,
          apodo,
          codigo_asistencia,
          asistencia,
          estado_evento,
          rol
      FROM ranked_events
      WHERE rn = 1
      ORDER BY nombre
    `;

    // Imprimir la consulta con los valores reales (solo una vez)
    console.log('\n=== CONSULTA SQL CON VALORES REALES ===');
    
    // Creamos una versión de la consulta con los valores reemplazados para mostrarla
    let sqlParaMostrar = sqlQuery;
    
    // Reemplazar :fecha_desde y :fecha_hasta
    sqlParaMostrar = sqlParaMostrar.replace(':fecha_desde', `'${fecha_desde}'`);
    sqlParaMostrar = sqlParaMostrar.replace(':fecha_hasta', `'${fecha_hasta}'`);
    
    // Reemplazar :coddivisiones si existe
    if (coddivisiones.length > 0) {
      const divisionesStr = coddivisiones.map(d => d).join(', ');
      sqlParaMostrar = sqlParaMostrar.replace(':coddivisiones', divisionesStr);
    }
    
    console.log(sqlParaMostrar);
    console.log('=======================================\n');
    
    // También mostramos los parámetros por separado
    console.log('📌 PARÁMETROS DE LA CONSULTA:');
    console.log('   Fecha desde:', fecha_desde);
    console.log('   Fecha hasta:', fecha_hasta);
    console.log('   Divisiones:', coddivisiones);
    console.log('=======================================\n');

    // Ejecutar la consulta con logging condicional
    let queryEjecutada = false; // Flag para controlar el logging
    
    const rows = await sequelize.query(
      sqlQuery,
      {
        replacements,
        type: sequelize.QueryTypes.SELECT,
        logging: (sql) => {
          // Solo mostrar el logging de Sequelize una vez
          if (!queryEjecutada) {
            console.log('\n🔍 SQL EJECUTADO POR SEQUELIZE:');
            console.log(sql);
            console.log('=======================================\n');
            queryEjecutada = true;
          }
        }
      }
    );

    console.log(`✅ Resultados obtenidos: ${rows.length} registros`);
    res.json(rows);

  } catch (err) {
    console.error('❌ Error en /asistencias_divisiones:', err);
    res.status(500).json({
      mensaje: 'Error interno',
      error: err.message
    });
  }
});


app.post("/evento_asistencia", verificarToken, async (req, res) => {
  const { codevento, codpersona, asistencia } = req.body;

  if (!codevento || !codpersona || !asistencia) {
    return res.status(400).json({ mensaje: "Faltan parámetros" });
  }

  try {
    await sequelize.query(
      `
      UPDATE det_evento
      SET asistencia = :asistencia
      WHERE codevento = :codevento
        AND codpersona = :codpersona
      `,
      {
        replacements: { codevento, codpersona, asistencia },
        type: sequelize.QueryTypes.UPDATE,
      }
    );

    return res.json({
      ok: true,
      mensaje: "Asistencia actualizada",
    });
  } catch (err) {
    console.error("Error en /evento_asistencia:", err);
    res.status(500).json({ mensaje: "Error interno" });
  }
});


app.post("/nuevo_evento", verificarToken, async (req, res) => {
  const { fecha, hora, observacion, divisiones, tipo, subtipo } = req.body;

  const fechaHora =
    fecha && hora ? `${fecha} ${hora}` : fecha ? `${fecha} 00:00:00` : null;

  const t = await sequelize.transaction();

  try {

    // 1️⃣ Crear evento
    // insertar evento
await sequelize.query(
  `
  INSERT INTO eventos (fecha, tipo, sub_tipo, observacion, estado)
  VALUES (:fecha, :tipo, :subtipo, :observacion, 'A')
  `,
  {
    replacements: { fecha: fechaHora, tipo, subtipo, observacion },
    transaction: t,
  }
);

// obtener id
const [[{ codevento }]] = await sequelize.query(
  `SELECT LAST_INSERT_ID() AS codevento`,
  { transaction: t }
);


    // 2️⃣ Por cada división
    for (const coddivision of divisiones) {
      // evento ↔ división
      await sequelize.query(
        `
        INSERT INTO det_evento_division (codevento, coddivision)
        VALUES (:codevento, :coddivision)
        `,
        {
          replacements: { codevento, coddivision },
          transaction: t,
        }
      );

      // 3️⃣ Personas de la división
      const personas = await sequelize.query(
        `
        SELECT p.codpersona
        FROM personas p
        INNER JOIN personas_divisiones pd 
          ON pd.codpersona = p.codpersona
        WHERE pd.coddivision = :coddivision
          AND p.estado <> 6 and p.estado <> 0
        `,
        {
          replacements: { coddivision },
          type: sequelize.QueryTypes.SELECT,
          transaction: t,
        }
      );

      // 4️⃣ Insertar personas en det_eventos
      for (const p of personas) {
        await sequelize.query(
          `
          INSERT INTO det_evento (codevento, codpersona, asistencia)
          VALUES (:codevento, :codpersona, 'I')
          `,
          {
            replacements: {
              codevento,
              codpersona: p.codpersona,
            },
            transaction: t,
          }
        );
      }
    }

    await t.commit();
    res.json({ ok: true, codevento });
  } catch (error) {
    await t.rollback();
    console.error(error);
    res.status(500).json({ error: "Error creando evento" });
  }
});




// Asociar personas a una división (insert o update)
app.post("/asociar_personas_division", verificarToken, async (req, res) => {
  const { coddivision, codrol, personas } = req.body;
  
  // Validaciones básicas
  if (!coddivision || !codrol || !personas || !Array.isArray(personas) || personas.length === 0) {
    return res.status(400).json({ 
      error: "Se requiere coddivision, codrol y un array de personas" 
    });
  }

  const t = await sequelize.transaction();
  
  try {
    const insertadas = [];
    const yaExistentes = [];

    // Por cada persona a asociar
    for (const codpersona of personas) {
      // Verificar si ya existe la relación
      const [existe] = await sequelize.query(
        `
        SELECT codpersona
        FROM personas_divisiones 
        WHERE codpersona = :codpersona 
          AND coddivision = :coddivision
        `,
        {
          replacements: { codpersona, coddivision },
          type: sequelize.QueryTypes.SELECT,
          transaction: t,
        }
      );

      if (existe) {
        // UPDATE: ya existe, actualizamos el rol
        await sequelize.query(
          `
          UPDATE personas_divisiones 
          SET codrol = :codrol              
          WHERE codpersona = :codpersona 
            AND coddivision = :coddivision
          `,
          {
            replacements: { codpersona, coddivision, codrol },
            transaction: t,
          }
        );
        yaExistentes.push(codpersona);
      } else {
        // INSERT: no existe, creamos nueva relación
        await sequelize.query(
          `
          INSERT INTO personas_divisiones 
            (codpersona, coddivision, codrol)
          VALUES 
            (:codpersona, :coddivision, :codrol)
          `,
          {
            replacements: { codpersona, coddivision, codrol },
            transaction: t,
          }
        );
        insertadas.push(codpersona);
      }
    }

    await t.commit();
    
    // Respuesta con resumen de lo que se hizo
    res.json({ 
      ok: true, 
      insertadas,
      yaExistentes,
      mensaje: `Se insertaron ${insertadas.length} y se actualizaron ${yaExistentes.length} registros`
    });
    
  } catch (error) {
    await t.rollback();
    console.error("Error en asociar_personas_division:", error);
    res.status(500).json({ 
      error: "Error al asociar personas a la división",
      detalle: error.message 
    });
  }
});

// Quitar persona de una división
app.post("/quitar_persona_division", verificarToken, async (req, res) => {
  const { coddivision, codpersona } = req.body;
  
  if (!coddivision || !codpersona) {
    return res.status(400).json({ 
      error: "Se requiere coddivision y codpersona" 
    });
  }

  try {
    const [result] = await sequelize.query(
      `
      DELETE FROM personas_divisiones 
      WHERE codpersona = :codpersona 
        AND coddivision = :coddivision
      `,
      {
        replacements: { codpersona, coddivision },
        type: sequelize.QueryTypes.DELETE,
      }
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        error: "No se encontró la relación persona-división" 
      });
    }

    res.json({ 
      ok: true, 
      mensaje: "Persona quitada de la división correctamente" 
    });
    
  } catch (error) {
    console.error("Error en quitar_persona_division:", error);
    res.status(500).json({ 
      error: "Error al quitar persona de la división",
      detalle: error.message 
    });
  }
});


app.post("/persona_detalle", verificarToken, async (req, res) => {
  const { codpersona } = req.body;

  try {
    if (!codpersona) {
      return res.status(400).json({ error: "Falta codpersona" });
    }

    const strsql = `
      SELECT
        p.codpersona,
        p.nombre,
        p.dni,
        p.fecha_nacimiento,
        p.activo,
        CASE p.activo
          WHEN 0 THEN 'Inactivo'
          WHEN 1 THEN 'Activo'
          WHEN 2 THEN 'Lesionado'
          WHEN 3 THEN 'Suspendido'
          WHEN 4 THEN 'Viaje'
          WHEN 5 THEN 'Enfermo'
          WHEN 6 THEN 'Baja'
          ELSE 'Desconocido'
        END AS estado_activo,
        p.email,
        p.telefono,
        p.apodo,
        p.color,
        p.usuario,
        p.clave,
        p.fotoperfil,
        p.tipo_usuario,
        p.estado,

        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'coddivision', d.coddivision,
              'descripcion', d.descripcion,
              'codrol', pd.codrol,
              'rol', r.descripcion
            )
          )
          FROM personas_divisiones pd
          LEFT JOIN divisiones d ON d.coddivision = pd.coddivision
          LEFT JOIN roles r ON r.codrol = pd.codrol
          WHERE pd.codpersona = p.codpersona
          ORDER BY d.descripcion
        ) AS divisiones

      FROM personas p
      WHERE p.codpersona = :codpersona
      GROUP BY p.codpersona
    `;

    const personas = await sequelize.query(strsql, {
      replacements: { codpersona },
      type: sequelize.QueryTypes.SELECT
    });

    if (!personas || personas.length === 0) {
      return res.status(404).json({ error: "Persona no encontrada" });
    }

    // NO HAGAS JSON.parse - MySQL ya te devuelve el objeto parseado
    const result = {
      ...personas[0],
      divisiones: personas[0].divisiones || [] // Solo asegura que no sea null
    };

    res.json(result);
  } catch (err) {
    console.error("Error obteniendo persona:", err);
    res.status(500).json({ error: "Error obteniendo persona" });
  }
});




async function cerrarEventosPendientes({ codclub, coddisciplina }) {

  console.log("cerrarEventosPendientes", codclub, coddisciplina);
  const [result] = await sequelize.query(`
    UPDATE eventos
    SET estado = 'F'
    WHERE estado = 'A'
      AND codclub = :codclub
      ${coddisciplina ? "AND coddisciplina = :coddisciplina" : ""}
      AND fecha < NOW() - INTERVAL 72 HOUR
  `, {
    replacements: { codclub, coddisciplina }
  });

  return result.affectedRows;
}


app.post("/eventos_detalles", verificarToken, async (req, res) => {
  const { codclub, coddisciplina, coddivisiones, fecha_desde, fecha_hasta } = req.body;

  try {

    await cerrarEventosPendientes({ codclub, coddisciplina });

    const tieneDivisiones =
      Array.isArray(coddivisiones) && coddivisiones.length > 0;

    const strsql = `
SELECT
  e.codevento,
  e.fecha,
  e.tipo,
  e.sub_tipo,
  e.observacion,
  e.estado,

  (
    SELECT JSON_ARRAYAGG(
      JSON_OBJECT(
        'coddivision', x.coddivision,
        'division', x.descripcion
      )
    )
    FROM (
      SELECT d.coddivision, d.descripcion
      FROM det_evento_division ded
      INNER JOIN divisiones d
        ON d.coddivision = ded.coddivision
      WHERE ded.codevento = e.codevento
      ORDER BY d.descripcion
    ) x
  ) AS divisiones,

  (
    SELECT JSON_ARRAYAGG(
      JSON_OBJECT(
        'codpersona', x.codpersona,
        'nombre', x.nombre,
        'apodo', x.apodo,
        'estado', x.estado,
        'rol', 'Jugador',
        'coddivision', x.coddivision,
        'division', x.division,
        'asistencia', x.asistencia
      )
    )
    FROM (
      SELECT
        p.codpersona,
        p.nombre,
        p.apodo,
        p.estado,
        d.coddivision,
        d.descripcion AS division,
        de.asistencia
      FROM det_evento de
      INNER JOIN personas p
        ON p.codpersona = de.codpersona
      INNER JOIN personas_divisiones pd
        ON pd.codpersona = p.codpersona
       AND pd.codrol = 1
       AND pd.estado = 'A'
      INNER JOIN divisiones d
        ON d.coddivision = pd.coddivision
      INNER JOIN det_evento_division ded2
        ON ded2.codevento = e.codevento
       AND ded2.coddivision = pd.coddivision
      WHERE de.codevento = e.codevento and p.estado <> '6'
      ORDER BY d.descripcion, p.nombre
    ) x
  ) AS personas

FROM eventos e
INNER JOIN det_evento_division dedf
  ON dedf.codevento = e.codevento
INNER JOIN divisiones df
  ON df.coddivision = dedf.coddivision

WHERE e.estado <> 'B'
  AND df.codclub = :codclub
  ${tieneDivisiones ? "AND dedf.coddivision IN (:coddivisiones)" : ""}
  ${fecha_desde && fecha_hasta ? "AND e.fecha BETWEEN :fecha_desde AND :fecha_hasta" : ""}

GROUP BY e.codevento
ORDER BY e.fecha DESC
`;

    console.log("Divisiones:", coddivisiones);
    console.log("Fechas:", fecha_desde, fecha_hasta);

    const eventos = await sequelize.query(strsql, {
      replacements: {
        codclub,
        coddivisiones,
        fecha_desde,
        fecha_hasta
      },
      type: sequelize.QueryTypes.SELECT
    });

    res.json(eventos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo eventos" });
  }
});


// Endpoint para cambiar el estado de un evento
app.post("/evento_estado", verificarToken, async (req, res) => {
  const { codevento, tipo } = req.body;

  // Validar que se reciban los parámetros necesarios
  if (!codevento || !tipo) {
    return res.status(400).json({ 
      error: "Se requieren codevento y tipo" 
    });
  }

  // Validar que el tipo sea un estado válido
  const estadosValidos = ['A', 'I', 'F', 'C', 'B']; // Activo, Inactivo, Finalizado, Cancelado, Eliminado o Baja
  if (!estadosValidos.includes(tipo)) {
    return res.status(400).json({ 
      error: "Tipo de estado no válido. Debe ser: A, I, F, B, o C" 
    });
  }

  try {
    // Ejecutar el update
    const [updatedRows] = await sequelize.query(
      `UPDATE eventos SET estado = :tipo WHERE codevento = :codevento`,
      {
        replacements: { codevento, tipo },
        type: sequelize.QueryTypes.UPDATE
      }
    );

    if (updatedRows === 0) {
      return res.status(404).json({ 
        error: "Evento no encontrado" 
      });
    }

    // Opcional: Devolver el evento actualizado
    const [eventoActualizado] = await sequelize.query(
      `SELECT * FROM eventos WHERE codevento = :codevento`,
      {
        replacements: { codevento },
        type: sequelize.QueryTypes.SELECT
      }
    );

    res.json({ 
      success: true, 
      message: `Estado del evento ${codevento} actualizado a ${tipo}`,
      evento: eventoActualizado[0]
    });

  } catch (err) {
    console.error("Error actualizando estado del evento:", err);
    res.status(500).json({ 
      error: "Error actualizando estado del evento",
      detalle: err.message 
    });
  }
});





//===========ACTIVIDADES==========================================
app.post('/actividades_club', verificarToken, async (req, res) => {
  const { codclub } = req.body;

  if (!codclub)
    return res.status(400).json({ mensaje: 'Falta codclub' });

  try {
    const rows = await sequelize.query(
      `
      SELECT 
        a.codactividad,
        a.descripcion
      FROM actividades a
      INNER JOIN actividades_clubes ac 
        ON ac.codactividad = a.codactividad
      WHERE ac.codclub = :codclub
        AND ac.estado = '1'
        AND a.estado = '1'
      ORDER BY a.descripcion;

      `,
      {
        replacements: { codclub },
        type: sequelize.QueryTypes.SELECT
      }
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error interno' });
  }
});

// ===================================================
// =========== MIDDLEWARE TOKEN ======================
// ===================================================
function verificarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token)
    return res.status(403).json({ mensaje: 'Token requerido' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secreto123');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ mensaje: 'Token inválido' });
  }
}





// ===================================================
// =========== RUTA DE PRUEBA ========================
// ===================================================
app.get('/', (req, res) => {
  res.json({ message: 'API funcionando!' });
});


// ===================================================
// ============= LEVANTAR SERVIDOR ===================
// ===================================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
