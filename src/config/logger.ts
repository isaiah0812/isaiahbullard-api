require('dotenv').config();

import { Logger, createLogger } from '@logdna/logger';

const logOptions = {
  app: process.env.APP_NAME as string,
  level: 'debug'
};

const logger: Logger | Console =
  process.env.NODE_ENV === 'LOCAL' || process.env.NODE_ENV === 'TEST' 
    ? console
    : createLogger(process.env.LOGDNA_KEY as string, logOptions);

export default logger;
