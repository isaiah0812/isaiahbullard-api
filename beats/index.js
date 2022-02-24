const express = require("express");
const logger = require('../utils/logger');
const db = require('../mongo/setup').getDb();

const router = express.Router();
const beats = db.collection('beats');

router.route('/')
  .get((req, res) => {
    logger.info(`Getting all beats for request from ${req.ip}`);
    beats.find().toArray((error, result) => {
      if(error) throw error

      res.json(result)
    })
  });

module.exports = router;