import { MongoClient, Db } from 'mongodb';
import { ClientConnectionError } from '../types/errors';
const { default: logger } = require('../config/logger')

require('dotenv').config();

const url = `mongodb://${process.env.MONGO_URL}`;
const client = new MongoClient(url);

logger.info(`Connecting to MongoDB at ${url}`);
let db: Db;

export const connectDb = async (): Promise<void> => {
  try {
    await client.connect();
    
    db = client.db('ibdb');
    logger.info('Connected to server.');
  } catch (connErr: any) {
    logger.error("Error Connecting to the MongoDB Server");
    throw new ClientConnectionError(connErr);
  }
}

export const getDb = (): Db => {
  return db;
}
