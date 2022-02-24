const express = require("express");
const logger = require('../utils/logger');
const db = require('../mongo/setup').getDb();

const router = express.Router();
const videos = db.collection('videos');

router.route('/')
  .get((req, res) => {
    logger.info(`Getting all videos for request from ${req.ip}`);
    videos.find().toArray((error, result) => {
      if(error) throw error

      res.json(result)
    })
  });

module.exports = router;