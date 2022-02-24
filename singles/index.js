const express = require("express");
const logger = require('../utils/logger');
const db = require('../mongo/setup').getDb();

const router = express.Router();
const singles = db.collection('singles');

router.route('/')
  .get((req, res) => {
    logger.info(`Getting all singles for request from ${req.ip}`);
    singles.find().toArray((error, result) => {
      if(error) throw error

      res.json(result)
    })
  });

module.exports = router;