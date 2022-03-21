/**
 * TODO: Consider turning beats page into real beat store and move beat tapes.
 * This is for the site, but still.
 */
import express, { Request, Response } from 'express';
import { getDb } from '../db/setup';
import { checkJwt } from '../config/auth';
const { default: logger } = require('../config/logger');

const db = getDb()
const router = express.Router();
const beats = db.collection('beats');

// TODO: POST / (add a beat)
router.route('/')
  .get((req: Request, res: Response) => {
    logger.info(`Getting all beats for request from ${req.ip}`);
    beats.find().toArray((error, result) => {
      if(error) throw error

      res.json(result)
    })
  })
  .post(checkJwt, (req: Request, res: Response) => {
    res.send(req.body);
  })

/**
 * TODO: 
 * - GET /:beatId (fetch a beat)
 * - PUT /:beatId (update a beat)
 */

module.exports = router;
