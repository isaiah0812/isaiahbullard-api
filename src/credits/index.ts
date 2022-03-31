import express, { Request, Response } from 'express';
import { Document, WithoutId } from 'mongodb';
import { checkJwt } from '../config/auth';
import { getDb } from '../db/setup';
import Credit from '../models/credit';
import { CreateError, InternalServerError, ValidationError } from '../models/errorHandling';
const { default: logger } = require('../config/logger');

const db = getDb();
const router = express.Router();
const credits = db.collection('credits');

router.route('/')
  .get((req: Request, res: Response) => {
    logger.info(`Getting all credits for request from ${req.ip}`);
    credits.find({}, { projection: { "_id": false }}).toArray((error: any, result: WithoutId<Document>[] | undefined) => {
      if(error) {
        logger.error("Error retrieving credits from db...");
        res.status(500).send("Error retrieving credits, error object coming soon");
        throw error;
      }

      res.json(result)
    })
  })
  .post(checkJwt, async (req: Request, res: Response) => {
    try {
      const credit: Credit = new Credit(req.body);
      const existingCredit: Document | null = await credits.findOne({ id: credit.id })

      if (existingCredit) {
        logger.warn(`Credit with id ${credit.id} already exists`);
        throw new CreateError("credits", `Credit with id '${credit.id}' already exists. Use a different title, or send an 'id' field with the request with a unique id for the beat`)
      } else {
        logger.info(`Creating beat with the id ${credit.id}...`);
        await credits.insertOne(credit);
        logger.info(`Credit '${credit.id}' created!`);
        res.send(credit as Credit);
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
 * - GET /:id (get credit)
 * - PUT /:id (update credit)
 * - DELETE /:id (delete credit)
 */

module.exports = router;
