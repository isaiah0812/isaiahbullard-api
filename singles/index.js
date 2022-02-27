const express = require("express");
const logger = require('../utils/logger');
const db = require('../mongo/setup').getDb();

const router = express.Router();
const singles = db.collection('singles');

/**
 * TODO:
 * - POST / (create a single)
 */
router.route('/')
  .get((req, res) => {
    logger.info(`Getting all singles for request from ${req.ip}`);
    singles.find().toArray((error, result) => {
      if(error) throw error

      res.json(result)
    })
  });

/**
 * TODO:
 * - GET /:id (get single)
 * - PUT /:id (update single)
 * - DELETE /:id (delete single)
 */

module.exports = router;