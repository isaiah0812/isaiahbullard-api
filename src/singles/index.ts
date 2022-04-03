import express, { Request, Response } from 'express';
import { Document, WithoutId } from 'mongodb';
import { checkJwt } from '../config/auth';
import { getDb } from '../db/setup';
import { CreateError, InternalServerError, ValidationError } from '../models/errorHandling';
import { Single } from '../models/single';
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
    singles.find({}, { projection: { "_id": false }}).toArray((error: any, result?: WithoutId<Document>[]) => {
      if(error) {
        logger.error("Error retrieving singles from db...");
        res.status(500).json(new InternalServerError(error))
        throw error;
      }

      res.json(result)
    })
  })
  .post(checkJwt, async (req: Request, res: Response) => {
    try {
      const single: Single = new Single(req.body);
      const existingSingle: Document | null = await singles.findOne({ id: single.id })

      if (existingSingle) {
        logger.warn(`Single with id ${single.id} already exists`);
        throw new CreateError("singles", `Single with id '${single.id}' already exists. Use a different title, or send an 'id' field with the request with a unique id for the single`)
      } else {
        logger.info(`Creating single with the id ${single.id}...`);
        await singles.insertOne(single);
        logger.info(`Single '${single.id}' created!`);
        res.send(single as Single);
      }
    } catch (e: any) {
      if (e instanceof ValidationError) {
        logger.error(e.message)
        res.status(400).json(e)
      } else if (e instanceof CreateError) {
        logger.warn(e.message)
        res.status(400).json(e)
      } else {
        logger.error(e.stack)
        res.status(500).json(new InternalServerError(e))
      }
    }
  })

/**
 * TODO:
 * - GET /:id (get single)
 * - PUT /:id (update single)
 * - DELETE /:id (delete single)
 */

module.exports = router;
