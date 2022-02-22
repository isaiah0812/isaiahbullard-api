require('dotenv').config();

const logdna = require('@logdna/logger')
const logOptions = {
  app: process.env.APP_NAME,
  level: 'debug'
};

const logger = 
  process.env.NODE_ENV === 'LOCAL' || process.env.NODE_ENV === 'TEST' 
    ? console 
    : logdna.createLogger(process.env.LOGDNA_KEY, logOptions);

module.exports = logger;