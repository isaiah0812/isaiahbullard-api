import express, { Request, Response } from 'express';
import { getDb } from '../db/setup';
const { default: logger } = require('../config/logger');

const db = getDb();
const router = express.Router();
const videos = db.collection('videos');

/**
 * TODO:
 * - POST / (create a video)
 */
router.route('/')
  .get((req: Request, res: Response) => {
    logger.info(`Getting all videos for request from ${req.ip}`);
    videos.find().toArray((error, result) => {
      if(error) throw error

      res.json(result)
    })
  });

/**
 * TODO:
 * - GET /:id (get video)
 * - PUT /:id (update video)
 * - DELETE /:id (delete video)
 */

module.exports = router;
