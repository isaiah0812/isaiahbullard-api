import express, { Request, Response } from 'express';
import { Document, WithoutId } from 'mongodb';
import { checkJwt } from '../config/auth';
import { getDb } from '../db/setup';
import { CreateError, InternalServerError, ValidationError } from '../models/errorHandling';
import { Video } from '../models/video';
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
    videos.find({}, { projection: { "_id": false }}).toArray((error: any, result?: WithoutId<Document>) => {
      if(error) {
        logger.error("Error retrieving videos from db...");
        res.status(500).json(new InternalServerError(error));
        throw error;
      }

      res.json(result)
    })
  })
  .post(checkJwt, async (req: Request, res: Response) => {
    try {
      const video: Video = new Video(req.body);
      const existingVideo: Document | null = await videos.findOne({ id: video.id })

      if (existingVideo) {
        logger.warn(`Video with id ${video.id} already exists`);
        throw new CreateError("videos", `Video with id '${video.id}' already exists. Use a different title, or send an 'id' field with the request with a unique id for the video`)
      } else {
        logger.info(`Creating video with the id ${video.id}...`);
        await videos.insertOne(video);
        logger.info(`Video '${video.id}' created!`);
        res.send(video as Video);
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
 * - GET /:id (get video)
 * - PUT /:id (update video)
 * - DELETE /:id (delete video)
 */

module.exports = router;
