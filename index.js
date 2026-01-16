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
        { expiresIn: '1h' }
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

  try {
    // Construimos la condición de divisiones solo si hay datos
    let whereDivision = '';
    const replacements = { fecha_desde, fecha_hasta };

    if (Array.isArray(coddivisiones) && coddivisiones.length > 0) {
      whereDivision = 'AND dd.coddivision IN (:coddivisiones)';
      replacements.coddivisiones = coddivisiones;
    }

    const rows = await sequelize.query(
      `

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
    LEFT JOIN roles r ON r.codrol = p.codrol
    WHERE e.fecha BETWEEN :fecha_desde AND :fecha_hasta
        ${whereDivision}
        AND r.descripcion = 'Jugador' 
        AND e.estado <> 'B'
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
      `,
      {
        replacements,
        type: sequelize.QueryTypes.SELECT
      }
    );

    res.json(rows);
    console.log(rows);

  } catch (err) {
    console.error('Error en /asistencias_divisiones:', err);
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
          AND p.estado <> 6
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
      WHERE de.codevento = e.codevento
      ORDER BY d.descripcion, p.nombre
    ) x
  ) AS personas

FROM eventos e
INNER JOIN det_evento_division dedf
  ON dedf.codevento = e.codevento
INNER JOIN divisiones df
  ON df.coddivision = dedf.coddivision

WHERE e.estado = 'A'
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
