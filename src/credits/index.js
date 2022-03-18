const express = require("express");
const logger = require('../config/logger');
const db = require('../db/setup').getDb();

const router = express.Router();
const credits = db.collection('credits');

/**
 * TODO:
 * - POST / (create a credit)
 */
router.route('/')
  .get((req, res) => {
    logger.info(`Getting all credits for request from ${req.ip}`);
    credits.find().toArray((error, result) => {
      if(error) throw error

      res.json(result)
    })
  });

/**
 * TODO:
 * - GET /:id (get credit)
 * - PUT /:id (update credit)
 * - DELETE /:id (delete credit)
 */

module.exports = router;