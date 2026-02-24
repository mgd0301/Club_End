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

      return res.json({ mensaje: 'Login Google OK', token, usuario });
    }

    res.status(400).json({ mensaje: 'Tipo de login inválido' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error interno' });
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
app.post('/divisiones_disciplina', verificarToken, async (req, res) => {
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
    // CASO 1: VIENE codasistencia Y ES MAYOR A 0 → HACER UPDATE (BAJA LÓGICA)
    if (codasistencia && parseInt(codasistencia) > 0) {
      
      // Validar que el registro exista
      const [existente] = await sequelize.query(
        `SELECT codasistencia FROM actividades_asistencia 
         WHERE codasistencia = :codasistencia`,
        {
          replacements: { codasistencia },
          type: sequelize.QueryTypes.SELECT
        }
      );

      if (!existente) {
        return res.status(404).json({ mensaje: 'El registro de asistencia no existe' });
      }

      // Actualizar estado (baja lógica)
      await sequelize.query(
        `UPDATE actividades_asistencia 
         SET estado = :estado
         WHERE codasistencia = :codasistencia`,
        {
          replacements: { 
            estado: estado || 'B',
            codasistencia 
          },
          type: sequelize.QueryTypes.UPDATE
        }
      );

      return res.json({ 
        mensaje: 'Asistencia actualizada (baja lógica) correctamente',
        codasistencia: codasistencia,
        accion: 'UPDATE'
      });
    }

    // CASO 2: NO VIENE codasistencia O VIENE 0 → HACER INSERT
    else {
      // Validar campos requeridos para INSERT
      if (!codclub) return res.status(400).json({ mensaje: 'Falta codclub' });
      if (!codactividad) return res.status(400).json({ mensaje: 'Falta codactividad' });
      if (!codpersona) return res.status(400).json({ mensaje: 'Falta codpersona' });
      if (!fecha) return res.status(400).json({ mensaje: 'Falta fecha' });

      // 🔥 CORRECCIÓN: Formatear fecha para MySQL
      const fechaMySQL = new Date(fecha).toISOString().slice(0, 19).replace('T', ' ');
      // '2026-02-17T18:01:17.000Z' → '2026-02-17 18:01:17'

      console.log('📅 Fecha original:', fecha);
      console.log('📅 Fecha formateada:', fechaMySQL);

      // Insertar nuevo registro
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
            fecha: fechaMySQL, // ← Usamos la fecha formateada
            observacion: observacion || null 
          },
          type: sequelize.QueryTypes.INSERT
        }
      );

      return res.json({ 
        mensaje: 'Asistencia registrada correctamente',
        codasistencia: result,
        accion: 'INSERT'
      });
    }

  } catch (error) {
    console.error('Error en actividad_asistencia:', error);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
  }
});

app.post('/personas_jugadores_actividades', verificarToken, async (req, res) => {
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

app.post('/historial_asistencias', verificarToken, async (req, res) => {
  const { codpersona, codactividad, dias = 30 } = req.body;
  
  if (!codpersona) return res.status(400).json({ mensaje: 'Falta codpersona' });
  if (!codactividad) return res.status(400).json({ mensaje: 'Falta codactividad' });

  try {
    const rows = await sequelize.query(`
      SELECT 
        aa.codasistencia,
        DATE_FORMAT(aa.fecha, '%d/%m/%Y') as fecha,
        DAYNAME(aa.fecha) as dia_semana,
        aa.estado,
        aa.observacion                
      FROM actividades_asistencia aa
      WHERE aa.codpersona = :codpersona
        AND aa.codactividad = :codactividad
        AND aa.estado = 'A'
        AND aa.fecha >= DATE_SUB(CURDATE(), INTERVAL :dias DAY)
      ORDER BY aa.fecha DESC
    `, {
      replacements: { codpersona, codactividad, dias },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({
      asistencias: rows,
      dias_consultados: dias,
      total_historico: rows.length > 0 ? rows[0].total_historico : 0
    });

  } catch (error) {
    console.error('Error en historial_asistencias:', error);
    res.status(500).json({ mensaje: 'Error interno del servidor' });
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
        type: sequelize.QueryTypes.SELECT
      }
    );
    
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error interno' });
  }
});


app.post('/historial_asistencia_actividades', verificarToken, async (req, res) => {
  const { 
    coddivisiones, // Array de divisiones ej: [12, 13] (puede venir vacío o no venir)
    codactividad, 
    esperado = 3, // Valor por defecto 3
    dias = 90 // Valor por defecto 90 días
  } = req.body;
  
  // Validaciones básicas
  if (!codactividad) return res.status(400).json({ mensaje: 'Falta codactividad' });

  try {
    let query = `
      SELECT 
        p.codpersona,
        p.nombre AS persona,
        semanas.semana,
        COUNT(*) AS asistencias,
        :esperado AS esperado,
        CONCAT(ROUND((COUNT(*) / :esperado) * 100, 2), '%') AS \`% asistencia\`
    `;
    
    // Agregar coddivision al SELECT solo si se está filtrando por divisiones
    if (coddivisiones && coddivisiones.length > 0) {
      query = `
        SELECT 
          p.codpersona,
          p.nombre AS persona,
          pd.coddivision,
          semanas.semana,
          COUNT(*) AS asistencias,
          :esperado AS esperado,
          CONCAT(ROUND((COUNT(*) / :esperado) * 100, 2), '%') AS \`% asistencia\`
      `;
    }
    
    query += `
      FROM (
        SELECT 
          aa.codpersona,
          aa.fecha,
          CONCAT(
            DATE_FORMAT(DATE_SUB(aa.fecha, INTERVAL (WEEKDAY(aa.fecha)) DAY), '%d/%m/%y'),
            '-',
            DATE_FORMAT(DATE_ADD(aa.fecha, INTERVAL (6 - WEEKDAY(aa.fecha)) DAY), '%d/%m/%y')
          ) AS semana,
          YEARWEEK(aa.fecha, 1) AS num_semana
        FROM actividades_asistencia aa
        WHERE aa.codactividad = :codactividad 
          AND aa.estado = 'A'
          AND aa.fecha >= DATE_SUB(CURDATE(), INTERVAL :dias DAY)
      ) semanas
      INNER JOIN personas p ON p.codpersona = semanas.codpersona
    `;
    
    const replacements = {
      codactividad,
      esperado,
      dias
    };
    
    let groupBy = 'GROUP BY p.codpersona, p.nombre, semanas.semana, semanas.num_semana';
    
    if (coddivisiones && coddivisiones.length > 0) {
      query += `
        INNER JOIN personas_divisiones pd ON pd.codpersona = p.codpersona
        WHERE pd.coddivision IN (:coddivisiones)
      `;
      replacements.coddivisiones = coddivisiones;
      groupBy = 'GROUP BY p.codpersona, p.nombre, pd.coddivision, semanas.semana, semanas.num_semana';
    }
    
    query += `
      ${groupBy}
      ORDER BY 
        p.nombre DESC,
        MIN(semanas.fecha) ASC
    `;

    console.log('Query final:', query); // Para debug
    console.log('Replacements:', replacements); // Para debug

    const rows = await sequelize.query(query, {
      replacements,
      type: sequelize.QueryTypes.SELECT
    });

    // Procesar los resultados
    const resultado = {
      parametros_consulta: {
        coddivisiones: coddivisiones || 'Todas las divisiones',
        codactividad,
        esperado,
        dias_consultados: dias
      },
      resumen_global: {
        total_personas: [...new Set(rows.map(r => r.codpersona))].length,
        total_asistencias: rows.reduce((sum, r) => sum + r.asistencias, 0),
        total_semanas: [...new Set(rows.map(r => r.semana))].length
      },
      detalle: rows
    };

    // Si no se filtró por divisiones, no incluir coddivision en el detalle
    if (!coddivisiones || coddivisiones.length === 0) {
      resultado.detalle = rows.map(({ coddivision, ...rest }) => rest);
    }

    res.json(resultado);

  } catch (error) {
    console.error('Error en historial_asistencia_actividades:', error);
    res.status(500).json({ 
      mensaje: 'Error interno del servidor',
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


app.post("/eventos_detalles", verificarToken, async (req, res) => {
  const { codclub, coddivisiones, fecha_desde, fecha_hasta } = req.body;

  try {
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
