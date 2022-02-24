const express = require("express");
const logger = require('../utils/logger');
const db = require('../mongo/setup').getDb();

const router = express.Router();
const merch = db.collection('merch');

router.route('/')
  .get((req, res) => {
    logger.info(`Getting all merch for request from ${req.ip}`);
    merch.find().toArray((error, result) => {
      if(error) throw error

      res.json(result)
    })
  });

module.exports = router;