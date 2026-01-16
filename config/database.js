const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');

// Asegurarse de que dotenv cargue las variables
dotenv.config({ path: '../../.env' });

// Verificar que las variables existen
const dbConfig = {
  host: process.env.DB_HOST || 'yamabiko.proxy.rlwy.net',
  port: process.env.DB_PORT || 37493,
  username: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'PlsdnaPYbAIXyzGoxIgIoTLYzIlrfEHD',
  database: process.env.DB_NAME || 'railway'
};

// Mostrar los parámetros de conexión
console.log('Parámetros de conexión a la base de datos:');
console.log('Host:', dbConfig.host);
console.log('Puerto:', dbConfig.port);
console.log('Usuario:', dbConfig.username);
console.log('Base de datos:', dbConfig.database);

const sequelize = new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
  host: dbConfig.host,
  port: dbConfig.port,
  dialect: 'mysql',
  logging: false,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

module.exports = sequelize;