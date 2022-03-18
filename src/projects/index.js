const express = require("express");
const logger = require('../config/logger');
const db = require('../db/setup').getDb();

const router = express.Router();
const projects = db.collection('projects');

/**
 * TODO:
 * - POST / (create a project)
 */
router.route('/')
  .get((req, res) => {
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
        projects.find({ beatTape: true }).toArray((error, result) => {
          if(error) throw error
          res.json(result)
        })
        break;
      // Return only Albums
      case 'false': 
        logger.info(`Getting all albums for request from ${req.ip}`);
        projects.find({ beatTape: false }).toArray((error, result) => {
          if(error) throw error
  
          res.json(result)
        })
        break;
      // Return all Projects
      default: 
        logger.info(`Getting all projects for request from ${req.ip}`);
        projects.find().toArray((error, result) => {
          if(error) throw error
  
          res.json(result)
        })
        break;
    }
  });

/**
 * TODO:
 * - GET /:id (get project)
 * - PUT /:id (update project)
 * - DELETE /:id (delete project)
 */

module.exports = router;