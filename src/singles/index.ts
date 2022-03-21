import express, { Request, Response } from 'express';
import { getDb } from '../db/setup';
const { default: logger } = require('../config/logger');

const db = getDb();
const router = express.Router();
const singles = db.collection('singles');

/**
 * TODO:
 * - POST / (create a single)
 */
router.route('/')
  .get((req: Request, res: Response) => {
    logger.info(`Getting all singles for request from ${req.ip}`);
    singles.find().toArray((error, result) => {
      if(error) throw error

      res.json(result)
    })
  });

/**
 * TODO:
 * - GET /:id (get single)
 * - PUT /:id (update single)
 * - DELETE /:id (delete single)
 */

module.exports = router;
