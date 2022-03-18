const express = require("express");
const logger = require('../config/logger');
const db = require('../db/setup').getDb();

const router = express.Router();
const videos = db.collection('videos');

/**
 * TODO:
 * - POST / (create a video)
 */
router.route('/')
  .get((req, res) => {
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