import express, { Request, Response } from 'express';
import { getDb } from '../db/setup';

const { default: logger } = require('../config/logger');
const db = getDb();
const router = express.Router();
const merch = db.collection('merch');

/**
 * TODO: 
 * - POST / (create new merch)
 */
router.route('/')
  .get((req: Request, res: Response) => {
    // TODO: Add filtering and sorting
    logger.info(`Getting all merch for request from ${req.ip}`);
    merch.find().toArray((error, result) => {
      if(error) throw error

      res.json(result)
    })
  });

/**
 * TODO:
 * - GET /:merchId (get merch item)
 * - PUT /:merchId (update merch item)
 * - DELETE /: merchId (delete merch item)
 */

module.exports = router;