require('dotenv').config();

const { MongoClient } = require('mongodb');
const { ClientConnectionError } = require('../types/errors');
const logger = require('../config/logger');

const url = `mongodb://${process.env.MONGO_URL}`;
const client = new MongoClient(url, { useUnifiedTopology: true });

logger.info(`Connecting to MongoDB at ${url}`);
let db;

const connectDb = async () => {
  try {
    await client.connect();
    
    db = client.db('ibdb');
    logger.info('Connected to server.');
  } catch (connErr) {
    logger.error("Error Connecting to the MongoDB Server");
    throw new ClientConnectionError(connErr);
  }
}

const getDb = () => {
  return db;
}

module.exports = { connectDb, getDb };