/**
 * TODO: Consider turning beats page into real beat store and move beat tapes.
 * This is for the site, but still.
 */
import express, { Request, Response } from 'express';
import { getDb } from '../db/setup';
import { checkJwt } from '../config/auth';
import { Document, WithoutId } from 'mongodb';
import Beat from '../models/beat';
import { CreateError, InternalServerError, ValidationError } from '../models/errorHandling';
const { default: logger } = require('../config/logger');

const db = getDb()
const router = express.Router();
const beats = db.collection('beats');

router.route('/')
  .get((req: Request, res: Response) => {
    logger.info(`Getting all beats for request from ${req.ip}`);
    beats.find({}, { projection: { "_id": false }}).toArray((error: any, result?: WithoutId<Document>[]) => {
      if(error) {
        logger.error("Error retrieving beats from db...");
        res.status(500).json(new InternalServerError(error));
        throw error;
      }

      res.json(result)
    })
  })
  .post(checkJwt, async (req: Request, res: Response) => {
    try {
      const beat: Beat = new Beat(req.body);
      const existingBeat: Document | null = await beats.findOne({ id: beat.id })

      if (existingBeat) {
        logger.warn(`Beat with id ${beat.id} already exists`);
        throw new CreateError("beats", `Beat with id '${beat.id}' already exists. Use a different title, or send an 'id' field with the request with a unique id for the beat`)
      } else {
        logger.info(`Creating beat with the id ${beat.id}...`);
        await beats.insertOne(beat);
        logger.info(`Beat '${beat.id}' created!`);
        res.send(beat as Beat);
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
 * - GET /:beatId (fetch a beat)
 * - PUT /:beatId (update a beat)
 * - DELETE /:beatId (delete a beat)
 */

module.exports = router;
