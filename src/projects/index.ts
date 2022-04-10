import express, { Request, Response } from 'express';
import { Document, WithoutId } from 'mongodb';
import { checkJwt } from '../config/auth';
import { getDb } from '../db/setup';
import { CreateError, InternalServerError, ValidationError } from '../models/errorHandling';
import { Album, AlbumType, BeatTape, BeatTapeType, Project, ProjectType } from '../models/project';
const { default: logger } = require('../config/logger');

const db = getDb();
const router = express.Router();
const projects = db.collection('projects');

/**
 * TODO:
 * - POST / (create a project)
 */
router.route('/')
  .get((req: Request, res: Response) => {
    /**
     * TODO:
     * - Add sorting by name and date
     * - Add 'album' query parameter
     */
    const beatTape = req.query.beatTape // beatTape query parameter
    switch(beatTape) {
      // Return only Beat Tapes
      case 'true': 
        logger.info(`Getting all beat tapes for request from ${req.ip}`);
        projects.find({ beatTape: true }, { projection: { "_id": false }}).toArray((error: any, result?: WithoutId<Document>) => {
          if(error) {
            logger.error("Error retrieving beat tapes from db...");
            res.status(500).json(new InternalServerError(error));
            throw error;
          }

          res.json(result);
        })
        break;
      // Return only Albums
      case 'false': 
        logger.info(`Getting all albums for request from ${req.ip}`);
        projects.find({ beatTape: false }, { projection: { "_id": false }}).toArray((error: any, result?: WithoutId<Document>) => {
          if(error) {
            logger.error("Error retrieving albums from db...");
            res.status(500).json(new InternalServerError(error));
            throw error;
          }
  
          res.json(result);
        })
        break;
      // Return all Projects
      default: 
        logger.info(`Getting all projects for request from ${req.ip}`);
        projects.find({}, { projection: { "_id": false }}).toArray((error: any, result?: WithoutId<Document>) => {
          if(error) {
            logger.error("Error retrieving projects from db...");
            res.status(500).json(new InternalServerError(error));
            throw error;
          }
  
          res.json(result);
        })
        break;
    }
  })
  .post(checkJwt, async (req: Request<{}, {}, ProjectType>, res: Response) => {
    try {
      const project: Project = 'beats' in req.body
        ? new BeatTape(req.body as BeatTapeType)
        : new Album(req.body as AlbumType);

      const existingProject: Document | null = await projects.findOne({ id: project.id })

      if (existingProject) {
        logger.warn(`Project with id ${project.id} already exists`);
        throw new CreateError("projects", `Project with id '${project.id}' already exists. Use a different title, or send an 'id' field with the request with a unique id for the project`)
      } else {
        logger.info(`Creating project with the id ${project.id}...`);
        await projects.insertOne(project);
        logger.info(`Project '${project.id}' created!`);
        res.send(project as Project);
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
 * - GET /:id (get project)
 * - PUT /:id (update project)
 * - DELETE /:id (delete project)
 */

module.exports = router;
