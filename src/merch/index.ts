import express, { Request, Response } from 'express';
import { Document } from 'mongodb';
import { checkJwt } from '../config/auth';
import { getDb } from '../db/setup';
import { CreateError, InternalServerError, ValidationError } from '../models/errorHandling';
import Merch from '../models/merch';

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
  })
  .post(checkJwt, async (req: Request, res: Response) => {
    try {
      const merchItem: Merch = new Merch(req.body);
      const existingMerchItem: Document | null = await merch.findOne({ id: merchItem.id })

      if (existingMerchItem) {
        logger.warn(`Merch with id ${merchItem.id} already exists`);
        throw new CreateError("merch", `Merch with id '${merchItem.id}' already exists. Use a different name, or send an 'id' field with the request with a unique id for the merch item`)
      } else {
        logger.info(`Creating merch item with the id ${merchItem.id}...`);
        await merch.insertOne(merchItem);
        logger.info(`Merch '${merchItem.id}' created!`);
        res.send(merchItem as Merch);
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
 * - GET /:merchId (get merch item)
 * - PUT /:merchId (update merch item)
 * - DELETE /: merchId (delete merch item)
 */

module.exports = router;
